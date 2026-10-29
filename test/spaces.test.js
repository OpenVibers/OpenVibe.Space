'use strict';
/**
 * Spaces (server/spaces/): a person makes a space from a template or from a sentence (the AI builder), edits and
 * previews it (the preview's SDK calls run as the maker), and publishes it as a site of their Spaces project, where it
 * is served with the app policy and the space SDK. A visitor signs in through the connect page (PKCE, a one-time code
 * traded from the space's own origin for a token bound to that space), adds to its shared lists, keeps private data and
 * asks its AI; capabilities, authorship, origins and the launch switch are enforced. Forks, deletion, the gallery and
 * the sitemap follow.
 */
const assert = require('assert');
const crypto = require('crypto');
const { boot, check, done } = require('./stageb/boot');

const ORIGIN = 'https://openvibe.space';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fakeAi() {
    const calls = [];
    const runs = new Map();
    return {
        calls, runs,
        runs_: runs,
        client: {
            runs: {
                async create(workflow, input, o) {
                    calls.push({ workflow, input, o });
                    if (workflow === 'space.app.ask') return { run: { id: 'run_ask', status: 'succeeded', output: { text: `Arr, ${input.instructions ? 'matey' : 'friend'}: call it Polly.` } } };
                    const id = `run_build_${runs.size + 1}`;
                    runs.set(id, { id, status: 'running' });
                    return { run: { id, status: 'queued' } };
                },
                async get(id) { return { run: runs.get(id) }; },
            },
        },
    };
}

(async () => {
    const ai = fakeAi();
    const t = await boot({ spacesAiClient: ai.client });
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice'), bob = t.user('bob'), carol = t.user('carol');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    let space = null;
    let slug = null;

    await check('the gallery shows the templates to everyone, with a sign-in to start', async () => {
        const r = await t.api('GET', '/spaces');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /<h1>Make a space\./);
        for (const name of ['Guestbook', 'AI buddy', 'Quick poll', 'Reaction game', 'Private to-dos']) assert.ok(r.text.includes(name), name);
        assert.match(r.text, /Sign in to start/);
        assert.doesNotMatch(r.text, /name="template"/, 'no start form for someone signed out');
    });

    await check('SEO-7: a gated page answers here with noindex and never another origin as its canonical', async () => {
        const gated = await t.api('GET', '/spaces/new');
        assert.strictEqual(gated.status, 401);
        assert.match(gated.text, /<meta name="robots" content="noindex,nofollow">/);
        assert.match(gated.text, /href="\/auth\/login\?next=%2Fspaces%2Fnew"/, 'one click from signing in');
        const canon = (/<link rel="canonical" href="([^"]+)"/.exec(gated.text) || [])[1];
        assert.ok(!canon || new URL(canon).origin === 'https://openvibe.space', `canonical ${canon}`);
        // The other half of the rule: a public page keeps its own canonical, on its own origin.
        const pub = await t.api('GET', '/spaces');
        assert.strictEqual(pub.status, 200);
        assert.match(pub.text, /<link rel="canonical" href="https:\/\/openvibe\.space\/spaces">/);
    });

    await check('a person starts a space from a template and lands in its editor', async () => {
        const r = await form(alice, '/spaces/new', { template: 'guestbook' });
        assert.strictEqual(r.status, 303, r.text);
        const m = /^\/spaces\/(guestbook-[0-9a-f]{4})\/edit$/.exec(r.headers.location);
        assert.ok(m, r.headers.location);
        slug = m[1];
        space = await t.ctx.spaces.getBySlug(slug);
        assert.deepStrictEqual([space.name, space.owner_username, JSON.parse(space.capabilities)], ['Guestbook', 'alice', ['profile', 'data']]);
        const ed = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
        assert.strictEqual(ed.status, 200);
        const bootJson = JSON.parse(/<script type="application\/json" id="sp-boot">([\s\S]*?)<\/script>/.exec(ed.text)[1]);
        assert.deepStrictEqual(bootJson.files.map((f) => f.path), ['index.html']);
        assert.match(bootJson.files[0].content, /\/_openvibe\/sdk\.js/);
        assert.match(ed.headers['content-security-policy'], /script-src 'self' 'unsafe-inline'.*https:\/\/cdn\.jsdelivr\.net/, 'the preview frame inherits a policy that lets a space\'s pinned CDN scripts run');
    });

    await check('a draft is the maker\'s alone; a form without its token is refused', async () => {
        assert.strictEqual((await t.api('GET', `/spaces/${slug}`, { session: bob })).status, 404, 'a stranger does not see a draft');
        assert.strictEqual((await t.api('GET', `/spaces/${slug}/edit`, { session: bob })).status, 404);
        assert.strictEqual((await t.api('GET', `/spaces/${slug}`, { session: alice })).status, 200);
        const gate = await t.api('GET', `/spaces/${slug}/edit`);
        assert.strictEqual(gate.status, 401, 'signed out: a gate page here, noindex, not a redirect off the site (SEO-7)');
        assert.match(gate.text, /<meta name="robots" content="noindex,nofollow">/);
        const forged = await t.api('POST', '/spaces/new', { session: alice, form: { csrf: 'nope', template: 'poll' }, headers: { origin: ORIGIN } });
        assert.strictEqual(forged.status, 403);
        const crossSite = await t.api('PUT', `/spaces/${slug}/files`, { session: alice, json: { files: [] }, headers: { origin: 'https://evil.example', 'x-csrf-token': csrf(alice) } });
        assert.strictEqual(crossSite.status, 403);
    });

    await check('saving files: safe paths, an index.html, within the limits', async () => {
        const html = '<!doctype html><html><body><h1>Guests</h1><script src="/_openvibe/sdk.js"></script><script src="app.js"></script></body></html>';
        const ok = await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: [{ path: 'index.html', content: html }, { path: 'app.js', content: 'OV.ready.then(() => {});' }] });
        assert.strictEqual(ok.status, 200, ok.text);
        assert.deepStrictEqual((await t.ctx.spaces.files(space)).map((f) => f.path), ['app.js', 'index.html']);
        for (const [files, code] of [
            [[{ path: '../x.html', content: 'x' }, { path: 'index.html', content: html }], 'space.invalid_path'],
            [[{ path: 'app.js', content: 'x' }], 'space.index_required'],
            [[{ path: 'index.html', content: html }, { path: 'INDEX.html', content: html }], 'space.duplicate_path'],
            [[{ path: 'index.html', content: 'x'.repeat(1024 * 1024 + 1) }], 'space.too_large'],
        ]) {
            const r = await edit(alice, 'PUT', `/spaces/${slug}/files`, { files });
            assert.strictEqual(r.json().error.code, code, JSON.stringify(files.map((f) => f.path)));
        }
    });

    await check('the preview runs the SDK as the maker: lists, private storage and the space\'s AI', async () => {
        const op = async (o, args) => edit(alice, 'POST', `/spaces/${slug}/preview`, { op: o, args });
        const added = await op('items.add', { collection: 'notes', value: { text: 'first!' } });
        assert.strictEqual(added.status, 200, added.text);
        assert.deepStrictEqual([added.json().result.mine, added.json().result.author.username], [true, 'alice']);
        const list = (await op('items.list', { collection: 'notes' })).json().result;
        assert.deepStrictEqual(list.map((i) => i.value.text), ['first!']);
        await op('kv.set', { key: 'theme', value: { dark: true } });
        assert.deepStrictEqual((await op('kv.get', { key: 'theme' })).json().result, { dark: true });
        await edit(alice, 'PUT', `/spaces/${slug}/settings`, { instructions: 'Talk like a pirate.', capabilities: ['profile', 'data', 'kv', 'ai'] });
        const asked = await op('ai.ask', { input: { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Ahoy' }, { role: 'user', content: 'name my parrot' }] } });
        assert.strictEqual(asked.json().result.text, 'Arr, matey: call it Polly.');
        const call = ai.calls.find((c) => c.workflow === 'space.app.ask');
        assert.deepStrictEqual([call.input.message, call.input.transcript, call.o.onBehalfOf], ['name my parrot', 'visitor: hi\nai: Ahoy', { type: 'user', id: alice.subject }]);
        assert.strictEqual((await op('items.add', { collection: 'bad name!', value: 1 })).json().error.code, 'space.invalid_name');
        assert.strictEqual((await op('nope', {})).json().error.code, 'space.unknown_op');
    });

    let url = null;
    await check('publishing deploys the files to a site in the maker\'s Spaces project, served with the app policy and the SDK', async () => {
        const r = await edit(alice, 'POST', `/spaces/${slug}/publish`);
        assert.strictEqual(r.status, 200, r.text);
        url = r.json().url;
        assert.strictEqual(url, `https://${slug}.openvibe.website`);
        space = await t.ctx.spaces.getBySlug(slug);
        assert.match(space.site_id, /^sit_/);
        const page = await t.get(`${slug}.openvibe.website`, '/');
        assert.strictEqual(page.status, 200);
        assert.match(page.text, /<h1>Guests<\/h1>/);
        const csp = page.headers['content-security-policy'];
        assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/cdnjs\.cloudflare\.com/);
        assert.match(csp, /connect-src 'self' https:\/\/openvibe\.space/);
        assert.match(csp, /frame-ancestors 'self' https:\/\/openvibe\.space/);
        const sdk = await t.get(`${slug}.openvibe.website`, '/_openvibe/sdk.js');
        assert.strictEqual(sdk.status, 200);
        assert.match(sdk.headers['content-type'], /javascript/);
        assert.ok(sdk.text.includes(`"id":"${space.id}"`) && sdk.text.includes('"mode":"live"') && sdk.text.includes('"api":"https://openvibe.space"'));
        const project = await t.ctx.store.db.prepare('SELECT p.name FROM space_app_projects a JOIN space_projects p ON p.id = a.project_id WHERE a.owner_subject = ?').get(alice.subject);
        assert.strictEqual(project.name, 'Spaces');
        // A second publish updates the same site.
        await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Guests v2</h1><script src="/_openvibe/sdk.js"></script></body></html>' }] });
        await edit(alice, 'POST', `/spaces/${slug}/publish`);
        assert.match((await t.get(`${slug}.openvibe.website`, '/')).text, /Guests v2/);
        assert.strictEqual((await t.ctx.spaces.getBySlug(slug)).site_id, space.site_id);
    });

    await check('the gallery and the sitemap list a published public space; its page embeds it', async () => {
        assert.match((await t.api('GET', '/spaces')).text, new RegExp(`href="/spaces/${slug}"`));
        assert.match((await t.api('GET', '/sitemap.xml')).text, new RegExp(`/spaces/${slug}</loc>`));
        const p = await t.api('GET', `/spaces/${slug}`, { session: bob });
        assert.strictEqual(p.status, 200);
        assert.match(p.text, new RegExp(`<iframe src="${url}"`));
        assert.match(p.headers['content-security-policy'], /frame-src [^;]*https:\/\/\*\.openvibe\.website/);
    });

    // A visitor signs in: the connect page, a code back to the space, traded from the space's origin.
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    let bobToken = null;
    await check('a visitor approves the space on the connect page and comes back with a one-time code', async () => {
        const q = `challenge=${challenge}&state=st4te-abc&return=${encodeURIComponent('/game?x=1')}`;
        assert.strictEqual((await t.api('GET', `/spaces/${slug}/connect?${q}`)).status, 401, 'signed out: sign in here first (a gate page, never a cross-origin redirect)');
        const page = await t.api('GET', `/spaces/${slug}/connect?${q}`, { session: bob });
        assert.strictEqual(page.status, 200);
        assert.match(page.text, /Ask OpenVibe AI for you/);
        assert.strictEqual(page.headers['x-frame-options'], 'DENY');
        const r = await form(bob, `/spaces/${slug}/connect`, { challenge, state: 'st4te-abc', return: '/game?x=1', decision: 'allow' });
        assert.strictEqual(r.status, 303);
        const m = new RegExp(`^${url}/game\\?x=1#ov_code=([A-Za-z0-9_-]+)&ov_state=st4te-abc$`).exec(r.headers.location);
        assert.ok(m, r.headers.location);
        const code = m[1];
        const tok = (o) => t.api('POST', `/api/v1/apps/${space.id}/token`, { json: { code, code_verifier: verifier }, headers: o ? { origin: o } : {} });
        assert.strictEqual((await tok('https://evil.example')).status, 403, 'another origin cannot trade it');
        assert.strictEqual((await tok(null)).status, 403, 'nor a request with no origin');
        const ok = await tok(url);
        assert.strictEqual(ok.status, 200, ok.text);
        assert.strictEqual(ok.headers['access-control-allow-origin'], url);
        bobToken = ok.json().token;
        assert.deepStrictEqual([ok.json().user.username, ok.json().capabilities], ['bob', ['profile', 'data', 'kv', 'ai']]);
        assert.strictEqual((await tok(url)).json().error.code, 'space.invalid_grant', 'a code works once');
        // Already approved: the next sign-in skips the page.
        const again = await t.api('GET', `/spaces/${slug}/connect?${q}`, { session: bob });
        assert.strictEqual(again.status, 303);
        assert.match(again.headers.location, /#ov_code=/);
        // The return path stays on the space's own host.
        const sneaky = await form(bob, `/spaces/${slug}/connect`, { challenge, state: 'st4te-abc', return: '//evil.example/x', decision: 'allow' });
        assert.ok(sneaky.headers.location.startsWith(`${url}/#ov_code=`), sneaky.headers.location);
        const denied = await form(carol, `/spaces/${slug}/connect`, { challenge, state: 'st4te-abc', return: '/', decision: 'deny' });
        assert.strictEqual(denied.headers.location, `${url}/`);
    });

    await check('the space\'s API: lists for everyone, writes and storage for the signed-in visitor, authorship enforced', async () => {
        const run = (o, args, token = bobToken, origin = url) => t.api('POST', `/api/v1/apps/${space.id}/run`, { json: { op: o, args }, headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
        const added = await run('items.add', { collection: 'notes', value: { text: 'hi from bob' } });
        assert.strictEqual(added.status, 200, added.text);
        assert.strictEqual(added.headers['access-control-allow-origin'], url);
        const pub = await t.api('GET', `/api/v1/apps/${space.id}/items/notes`, { headers: { origin: url } });
        assert.deepStrictEqual(pub.json().items.map((i) => [i.author.username, i.value.text]), [['bob', 'hi from bob'], ['alice', 'first!']]);
        assert.strictEqual((await run('items.add', { collection: 'notes', value: 1 }, null)).json().error.code, 'auth.required');
        assert.strictEqual((await run('items.list', { collection: 'notes' }, null, 'https://evil.example')).status, 403, 'only the space\'s own page');
        const alicesNote = pub.json().items.find((i) => i.author.username === 'alice');
        assert.strictEqual((await run('items.remove', { collection: 'notes', id: alicesNote.id })).json().error.code, 'space.not_author');
        await run('items.set', { collection: 'votes', value: { option: 1 } });
        await run('items.set', { collection: 'votes', value: { option: 2 } });
        const votes = (await run('items.list', { collection: 'votes' })).json().result;
        assert.deepStrictEqual(votes.map((v) => [v.value.option, v.mine]), [[2, true]], 'set keeps one item per person');
        await run('kv.set', { key: 'theme', value: 'mine' });
        assert.strictEqual((await run('kv.get', { key: 'theme' })).json().result, 'mine');
        const alicesTheme = await edit(alice, 'POST', `/spaces/${slug}/preview`, { op: 'kv.get', args: { key: 'theme' } });
        assert.deepStrictEqual(alicesTheme.json().result, { dark: true }, 'each person\'s storage is their own');
        assert.strictEqual((await run('ai.ask', { input: 'name my parrot' })).json().result.text, 'Arr, matey: call it Polly.');
        assert.deepStrictEqual(ai.calls.filter((c) => c.workflow === 'space.app.ask').pop().o.onBehalfOf, { type: 'user', id: bob.subject }, 'on behalf of the visitor');
        assert.strictEqual((await run('me', {}, 'x'.repeat(43))).json().error.code, 'auth.required', 'a made-up token is no sign-in');
        const out = await t.api('DELETE', `/api/v1/apps/${space.id}/token`, { headers: { origin: url, authorization: `Bearer ${bobToken}` } });
        assert.strictEqual(out.status, 200);
        assert.strictEqual((await run('kv.get', { key: 'theme' })).status, 401, 'signed out');
    });

    await check('a capability the space did not ask for is refused', async () => {
        await edit(alice, 'PUT', `/spaces/${slug}/settings`, { capabilities: ['profile', 'data'] });
        const v2 = b64url(crypto.randomBytes(32));
        const c2 = b64url(crypto.createHash('sha256').update(v2).digest());
        const r = await form(carol, `/spaces/${slug}/connect`, { challenge: c2, state: 'state-two', return: '/', decision: 'allow' });
        const code = /#ov_code=([^&]+)/.exec(r.headers.location)[1];
        const tok = (await t.api('POST', `/api/v1/apps/${space.id}/token`, { json: { code, code_verifier: v2 }, headers: { origin: url } })).json().token;
        const asked = await t.api('POST', `/api/v1/apps/${space.id}/run`, { json: { op: 'ai.ask', args: { input: 'hi' } }, headers: { origin: url, authorization: `Bearer ${tok}` } });
        assert.strictEqual(asked.json().error.code, 'space.capability');
    });

    await check('the AI builder: a sentence becomes a space, polled until the run finishes', async () => {
        const r = await form(bob, '/spaces/new', { prompt: 'A pizza topping poll with live results' });
        assert.strictEqual(r.status, 303, r.text);
        const s = await t.ctx.spaces.getBySlug(/^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1]);
        assert.ok(s.building_run_id);
        const call = ai.calls.find((c) => c.workflow === 'space.app.build' && c.input.prompt.startsWith('A pizza'));
        assert.deepStrictEqual([call.o.onBehalfOf, call.o.wait], [{ type: 'user', id: bob.subject }, 0]);
        const poll = () => edit(bob, 'GET', `/spaces/${s.slug}/ai`);
        assert.strictEqual((await poll()).json().status, 'running');
        ai.runs.set(s.building_run_id, { id: s.building_run_id, status: 'succeeded', output: { name: 'Pizza poll', description: 'Vote for a topping.', instructions: '', capabilities: ['profile', 'data'], files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Pizza</h1></body></html>' }] } });
        const done1 = (await poll()).json();
        assert.deepStrictEqual([done1.status, done1.space.name, done1.files.map((f) => f.path)], ['done', 'Pizza poll', ['index.html']]);
        assert.strictEqual((await poll()).json().status, 'idle', 'applied once');
        // A change to an existing space sends its current files.
        await edit(bob, 'POST', `/spaces/${s.slug}/ai`, { prompt: 'make it blue' });
        const change = ai.calls.filter((c) => c.workflow === 'space.app.build').pop();
        assert.deepStrictEqual([change.input.name, change.input.current.map((f) => f.path)], ['Pizza poll', ['index.html']]);
        const s2 = await t.ctx.spaces.get(s.id);
        ai.runs.set(s2.building_run_id, { id: s2.building_run_id, status: 'failed' });
        assert.strictEqual((await poll()).json().status, 'failed');
        assert.strictEqual((await t.ctx.spaces.get(s.id)).name, 'Pizza poll', 'a failed change leaves the space as it was');
    });

    await check('a fork is the forker\'s own draft; the original counts it', async () => {
        const r = await form(carol, `/spaces/${slug}/fork`, {});
        assert.strictEqual(r.status, 303);
        const copy = await t.ctx.spaces.getBySlug(/^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1]);
        assert.deepStrictEqual([copy.owner_username, copy.forked_from, copy.site_id], ['carol', space.id, null]);
        assert.strictEqual((await t.ctx.spaces.get(space.id)).forks, 1);
        assert.strictEqual((await edit(carol, 'PUT', `/spaces/${slug}/files`, { files: [{ path: 'index.html', content: '<p>mine now</p>' }] })).status, 403, 'not the original');
    });

    await check('unpublishing stops the address and the API; deleting removes the space', async () => {
        await edit(alice, 'POST', `/spaces/${slug}/unpublish`);
        assert.notStrictEqual((await t.get(`${slug}.openvibe.website`, '/')).status, 200);
        assert.strictEqual((await t.api('GET', `/api/v1/apps/${space.id}/items/notes`, { headers: { origin: url } })).status, 404);
        assert.strictEqual((await t.api('GET', `/spaces/${slug}`, { session: bob })).status, 404, 'a draft again');
        await edit(alice, 'POST', `/spaces/${slug}/delete`);
        assert.strictEqual((await t.api('GET', `/spaces/${slug}`, { session: alice })).status, 404);
        for (const table of ['space_apps', 'space_app_files', 'space_app_items', 'space_app_kv', 'space_app_grants']) {
            const n = (await t.ctx.store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table === 'space_apps' ? 'id' : 'space_id'} = ?`).get(space.id)).n;
            assert.strictEqual(Number(n), 0, `${table}: deleting is for good`);
        }
    });

    await t.close();

    // Before the public launch: everyone makes and previews; only staff publish.
    const t2 = await boot({ env: { SPACE_PUBLIC_HOSTING: 'off' }, spacesAiClient: fakeAi().client });
    const dana = t2.user('dana'), root = t2.user('root', { role: 'admin' });
    const csrf2 = (u) => csrfToken(t2.config, { subject: u.subject });
    await check('before the public launch a person makes and previews a space; publishing waits (staff may)', async () => {
        const make = async (u) => {
            const r = await t2.api('POST', '/spaces/new', { session: u, form: { csrf: csrf2(u), template: 'poll' }, headers: { origin: ORIGIN } });
            return /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
        };
        const s = await make(dana);
        const hdr = (u) => ({ origin: ORIGIN, 'x-csrf-token': csrf2(u) });
        const pv = await t2.api('POST', `/spaces/${s}/preview`, { session: dana, json: { op: 'items.set', args: { collection: 'votes', value: { option: 0 } } }, headers: hdr(dana) });
        assert.strictEqual(pv.status, 200, 'the preview works before launch');
        const pub = await t2.api('POST', `/spaces/${s}/publish`, { session: dana, headers: hdr(dana) });
        assert.deepStrictEqual([pub.status, pub.json().error.code], [403, 'space.not_launched']);
        const staffSpace = await make(root);
        assert.strictEqual((await t2.api('POST', `/spaces/${staffSpace}/publish`, { session: root, headers: hdr(root) })).status, 200, 'staff publish');
    });
    await t2.close();

    await check('the SDK (live and preview) and every template\'s scripts compile', async () => {
        const { sdkSource } = require('../server/spaces/sdk');
        for (const mode of ['live', 'preview']) new Function(sdkSource({ mode, space: { id: 'spc_X', slug: 'x-1234', name: 'X </script>' }, api: 'https://openvibe.space', avatar: 'https://openvibe.network/avatar/{username}' }));
        assert.ok(!sdkSource({ space: { id: 'spc_X', slug: 'x', name: '</script><b>' } }).includes('</script>'), 'a name cannot close the script');
        const templates = require('../server/spaces/templates');
        for (const tpl of templates.list()) {
            const html = templates.files(tpl.id)[0].content;
            assert.match(html, /<script src="\/_openvibe\/sdk\.js"><\/script>/, tpl.id);
            for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
        }
    });

    const { cleanReturn } = require('../server/spaces/pages');
    await check('a return path stays a path on the space\'s own host', async () => {
        assert.deepStrictEqual(['/play?x=1', '//evil.example', 'https://evil.example', '/a\\b', '/ok#frag', '/x y', ''].map(cleanReturn), ['/play?x=1', '/', '/', '/', '/ok', '/', '/']);
    });
    done();
})().catch((err) => { console.error(err); process.exit(1); });
