'use strict';
/**
 * Space functions (server/spaces/functions.js): a space's functions/<name>.js runs on the server in a QuickJS sandbox.
 * The runner answers JSON, HTML and full responses (only content-type and cache-control headers pass), stops a
 * runaway loop on its CPU budget and a stuck promise on its deadline, exposes no Node, network or files, and caps the
 * `ov` calls of one run and the calls per caller. The editor's preview runs the unsaved copy as the maker; a published
 * space serves the published copy at /api/<name> (GET and POST, JSON and form bodies) and never serves functions/ as
 * files; a signed-in visitor's token reaches the function as ov.user and their approved writes; the space's own store
 * is apart from every visitor's.
 */
const assert = require('assert');
const crypto = require('crypto');
const { boot, check, done } = require('./stageb/boot');
const { createSpaceFunctions, toResponse } = require('../server/spaces/functions');

const ORIGIN = 'https://openvibe.space';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

(async () => {
    // ── The runner alone, over a fake store ──
    const kv = new Map();
    const fake = {
        listItems: async () => [],
        addItem: async (space, person, collection, value) => ({ id: '1', value, author: { username: person.username } }),
        kvGet: async (space, person, key) => (kv.has(`${person.subject}/${key}`) ? kv.get(`${person.subject}/${key}`) : null),
        kvSet: async (space, person, key, value) => { kv.set(`${person.subject}/${key}`, value); return true; },
    };
    const fns = createSpaceFunctions({ data: fake, workers: 1 });
    const space = { id: 'spc_T', slug: 'demo', name: 'Demo' };
    const req = { method: 'GET', path: '/api/x', query: {}, headers: {}, body: null };
    const run = (code, o = {}) => fns.call(space, 'x', code, req, { caller: o.caller || `c${Math.random()}`, ...o });

    await check('the runner answers JSON, HTML and full responses, keeping only content-type and cache-control', async () => {
        const json = await run('async function handle(r, ov) { const n = (await ov.store.get("n")) || 0; await ov.store.set("n", n + 1); console.log("n is", n); return { n: n + 1 }; }');
        assert.deepStrictEqual([json.status, json.headers['content-type'], json.body, json.logs], [200, 'application/json; charset=utf-8', '{"n":1}', [['log', 'n is 0']]]);
        assert.strictEqual(kv.get('space:spc_T/n'), 1, 'the space\'s own store');
        assert.deepStrictEqual([(await run('function handle() { return "<h1>hi</h1>"; }')).headers['content-type']], ['text/html; charset=utf-8']);
        const full = await run('function handle() { return { status: 201, headers: { "Content-Type": "text/csv", "Set-Cookie": "a=1", "Cache-Control": "public, max-age=60" }, body: "a,b" }; }');
        assert.deepStrictEqual([full.status, full.headers, full.body], [201, { 'content-type': 'text/csv', 'cache-control': 'public, max-age=60' }, 'a,b']);
        assert.strictEqual((await run('function handle() {}')).status, 204);
        assert.deepStrictEqual(toResponse({ status: 99, body: { a: 1 } }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"a":1}' });
    });

    await check('a runaway loop stops on its CPU budget, a stuck promise on its deadline; nothing of Node is reachable', async () => {
        let t0 = Date.now();
        const loop = await run('function handle() { while (true) {} }');
        assert.deepStrictEqual([loop.status, /CPU time/.test(loop.body)], [504, true]);
        assert.ok(Date.now() - t0 < 3000, `the loop stopped in ${Date.now() - t0} ms`);
        t0 = Date.now();
        const stuck = await run('async function handle() { await new Promise(() => {}); }');
        assert.deepStrictEqual([stuck.status, /ran out of time/.test(stuck.body)], [504, true]);
        assert.ok(Date.now() - t0 < 7000);
        const escape = await run('function handle() { return [typeof require, typeof process, typeof fetch, typeof XMLHttpRequest, typeof setTimeout, typeof WebAssembly].join(); }');
        assert.strictEqual(escape.body, 'undefined,undefined,undefined,undefined,undefined,undefined');
        assert.match((await run('function handle( {')).body, /did not load: SyntaxError/);
        assert.match((await run('const x = 1;')).body, /must define handle/);
        assert.match((await run('function f() { return f() + 1; } function handle() { return f(); }')).body, /stack overflow|recursed/);
        assert.strictEqual((await run('function handle() { return "still fine"; }')).body, 'still fine', 'the worker survives all of it');
    });

    await check('the module and CommonJS spellings of a handler work (models write them)', async () => {
        const spellings = {
            'export async function handle(r, ov) {\n  return "a";\n}': 'a',
            'export default async function handle() { return "b"; }': 'b',
            'export default function (r) { return "c" + r.method; }': 'cGET',
            'const handle = async () => "d";\nexport { handle };': 'd',
            'async function handle() { return "e"; }\nexport default handle;': 'e',
            'module.exports = { handle: async () => "f" };': 'f',
            'module.exports = async () => "g";': 'g',
            'exports.handle = () => "h";': 'h',
            'export const handle = () => "i";': 'i',
        };
        for (const [code, want] of Object.entries(spellings)) assert.strictEqual((await run(code)).body, want, code);
        const err = await run('// one\n// two\nexport function handle() { return nope; }');
        assert.match(err.body, /'?nope'? is not defined \(line 3\)/, 'the error and its line');
        const { asScript } = require('../server/spaces/functions');
        assert.strictEqual(asScript('a\nexport function handle() {}\nb').split('\n').length, 3, 'lines keep their numbers');
        assert.strictEqual(asScript('const s = "export function x";'), 'const s = "export function x";', 'only at the start of a line');
    });

    await check('one run makes at most 100 ov calls; a caller makes a limited number of calls a minute', async () => {
        const many = await run('async function handle(r, ov) { for (let i = 0; i < 150; i++) await ov.store.get("k"); return "done"; }');
        assert.deepStrictEqual([many.status, /at most 100 ov calls/.test(many.body)], [500, true]);
        await run('function handle() { return 1; }', { caller: 'same', perCallerPerMinute: 2 });
        await run('function handle() { return 1; }', { caller: 'same', perCallerPerMinute: 2 });
        await assert.rejects(run('function handle() { return 1; }', { caller: 'same', perCallerPerMinute: 2 }), (e) => e.status === 429);
        await assert.rejects(fns.call(space, 'Bad Name', 'function handle() {}', req), (e) => e.status === 404);
    });
    await fns.close();

    // ── In Space: the preview, the published space, a signed-in visitor ──
    const t = await boot();
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice'), bob = t.user('bob');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    let slug, host, spaceRow;
    try {
        await check('a space made from the trivia starter has its function; the preview runs it (and the unsaved copy) as the maker', async () => {
            const r = await form(alice, '/spaces/new', { template: 'trivia' });
            slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            host = `${slug}.openvibe.website`;
            spaceRow = await t.ctx.spaces.getBySlug(slug);
            assert.deepStrictEqual((await t.ctx.spaces.files(spaceRow)).map((f) => f.path).sort(), ['functions/check.js', 'index.html']);
            const fn = (args) => edit(alice, 'POST', `/spaces/${slug}/preview`, { op: 'fn.call', args });
            const right = (await fn({ name: 'check', method: 'POST', body: { id: 'sun', answer: ' Mercury ' } })).json().result;
            assert.deepStrictEqual([right.status, JSON.parse(right.body), right.logs], [200, { right: true, solved: 1 }, [['log', 'sun right']]]);
            const draft = (await fn({ name: 'check', source: 'function handle(r, ov) { return { who: ov.user.username, x: r.query.x, m: r.method }; }', query: { x: 1 } })).json().result;
            assert.deepStrictEqual(JSON.parse(draft.body), { who: 'alice', x: '1', m: 'GET' });
            assert.strictEqual((await fn({ name: 'missing' })).json().error.code, 'space.function_not_found');
            assert.strictEqual((await edit(bob, 'POST', `/spaces/${slug}/preview`, { op: 'fn.call', args: { name: 'check' } })).status, 404, 'only the maker (a draft is hidden from others)');
        });

        await check('published, /api/<name> runs the published copy for GET and POST; functions/ is never served as a file', async () => {
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/publish`)).status, 200);
            const get = await t.get(host, '/api/check');
            assert.deepStrictEqual([get.status, get.json(), get.headers['cache-control']], [200, { questions: 5 }, 'private, no-store']);
            assert.match(get.headers['content-security-policy'], /connect-src 'self'/, 'the app policy');
            const post = (body, headers = { 'content-type': 'application/json' }) => t.get(host, '/api/check', { method: 'POST', body, headers });
            assert.deepStrictEqual((await post(JSON.stringify({ id: 'moon', answer: '1969' }))).json(), { right: true, solved: 1 });
            assert.deepStrictEqual((await post(JSON.stringify({ id: 'moon', answer: '1970' }))).json(), { right: false, solved: 1 });
            assert.deepStrictEqual((await post('id=ocean&answer=Pacific', { 'content-type': 'application/x-www-form-urlencoded' })).json(), { right: true, solved: 1 });
            assert.strictEqual((await post('{nope')).status, 400);
            assert.strictEqual((await post(JSON.stringify({ x: 'a'.repeat(70 * 1024) }))).status, 413);
            assert.strictEqual((await post(JSON.stringify({ id: 'nope' }))).status, 400, 'the function\'s own status');
            for (const p of ['/functions/check.js', '/function%73/check.js', '/functions/', '/functions']) {
                const f = await t.get(host, p);
                assert.strictEqual(f.status, 404, p);
                assert.ok(!f.text.includes('mercury'), `${p} does not leak the answers`);
            }
            assert.strictEqual((await t.get(host, '/api/nope')).status, 404);
            assert.strictEqual((await t.get(host, '/api/nope', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 404);
            assert.strictEqual((await t.get(host, '/api/check', { method: 'PUT', body: '{}' })).status, 405);
            assert.strictEqual((await t.get(host, '/index.html', { method: 'POST', body: '{}' })).status, 405, 'the rest stays static');
            // A saved but unpublished change does not run until it is published.
            await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: [...(await t.ctx.spaces.files(spaceRow)).filter((f) => f.path !== 'functions/check.js'), { path: 'functions/check.js', content: 'function handle() { return "draft"; }' }] });
            assert.deepStrictEqual((await t.get(host, '/api/check')).json(), { questions: 5 });
        });

        await check('a signed-in visitor reaches the function as ov.user and their approved writes; the space\'s store is its own', async () => {
            await edit(alice, 'PUT', `/spaces/${slug}/settings`, { capabilities: ['profile', 'data', 'kv'] });
            const files = (await t.ctx.spaces.files(spaceRow)).filter((f) => !f.path.startsWith('functions/'));
            await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: [...files,
                { path: 'functions/check.js', content: 'function handle() { return { questions: 5 }; }' },
                { path: 'functions/whoami.js', content: 'async function handle(r, ov) { const item = r.method === "POST" ? await ov.items.add("notes", { text: r.body.text }) : null; return { user: ov.user, by: item && item.author.username, secret: await ov.store.get("solved-moon") }; }' },
                { path: 'functions/cached.js', content: 'function handle() { return { status: 200, headers: { "cache-control": "public, max-age=60" }, body: "<p>hello</p>" }; }' },
            ] });
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/publish`)).status, 200);
            const verifier = b64url(crypto.randomBytes(32));
            const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
            const r = await form(bob, `/spaces/${slug}/connect`, { challenge, state: 'st4te-abc', return: '/', decision: 'allow' });
            const code = /#ov_code=([A-Za-z0-9_-]+)/.exec(r.headers.location)[1];
            const token = (await t.api('POST', `/api/v1/apps/${spaceRow.id}/token`, { json: { code, code_verifier: verifier }, headers: { origin: `https://${host}` } })).json().token;
            const anon = (await t.get(host, '/api/whoami')).json();
            assert.deepStrictEqual(anon, { user: null, by: null, secret: 1 }, 'the function reads the space\'s store');
            const signed = await t.get(host, '/api/whoami', { method: 'POST', body: JSON.stringify({ text: 'hi' }), headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });
            assert.deepStrictEqual(signed.json(), { user: { username: 'bob', display_name: 'bob' }, by: 'bob', secret: 1 });
            const anonPost = await t.get(host, '/api/whoami', { method: 'POST', body: JSON.stringify({ text: 'anon' }), headers: { 'content-type': 'application/json' } });
            assert.strictEqual(anonPost.json().by, slug, 'signed out, the space writes as itself');
            const visitorKv = await t.api('POST', `/api/v1/apps/${spaceRow.id}/run`, { json: { op: 'kv.get', args: { key: 'solved-moon' } }, headers: { origin: `https://${host}`, authorization: `Bearer ${token}` } });
            assert.strictEqual(visitorKv.json().result, null, 'a visitor never reads the space\'s store');
            const cached = await t.get(host, '/api/cached');
            assert.deepStrictEqual([cached.headers['cache-control'], cached.headers['content-type'], cached.text], ['public, max-age=60', 'text/html; charset=utf-8', '<p>hello</p>']);
            const cachedSigned = await t.get(host, '/api/cached', { headers: { authorization: `Bearer ${token}` } });
            assert.strictEqual(cachedSigned.headers['cache-control'], 'private, no-store', 'never cached for a signed-in visitor');
        });

        await check('the trivia starter\'s function compiles', async () => {
            const tpl = require('../server/spaces/templates').files('trivia');
            new Function(tpl.find((f) => f.path === 'functions/check.js').content);
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
