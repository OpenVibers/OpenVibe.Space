'use strict';
/**
 * What Space says about itself while it is rebuilt: the home page is honest (code and dynamic pages,
 * and "spaces" apps; nothing published yet) and links the forum on OpenVibe.Community; the discovery
 * files describe the same site and the sitemap holds the home page and the spaces gallery; health and readiness answer.
 */
const assert = require('assert');

function assertSitemapLastmods(xml, tag = 'url') {
    const entries = [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))];
    for (const [, body] of entries) {
        const match = /<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/.exec(body);
        assert.ok(match, body);
        assert.strictEqual(new Date(match[1]).toISOString().slice(0, 10), match[1]);
    }
    return entries;
}

const { boot, check, done } = require('./helpers/app');

(async () => {
    const t = await boot();

    await check('the home page leads with spaces, describes staff static hosting and links the forum on OpenVibe.Community', async () => {
        const r = await t.get('/');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /<h1>Make a space\.<span class="sc-accent"> An app on your OpenVibe account\.<\/span><\/h1>/);
        assert.match(r.text, /href="\/spaces\/new"/, 'the home page starts a space');
        assert.match(r.text, /<h2[^>]*>Static hosting: publish a site, keep every deploy\.<\/h2>/);
        assert.match(r.text, /Immutable, content-addressed deploys with one-step rollback/);
        assert.match(r.text, /OpenVibe staff host here today; it opens to everyone once abuse handling/);
        assert.match(r.text, /What works now/);
        assert.match(r.text, /showcase\.css/, 'built from the network\'s showcase sections');
        assert.match(r.text, /The forum moved to OpenVibe\.Community/);
        assert.match(r.text, /href="https:\/\/openvibe\.community\/s"/, 'the forum link points at Community');
        assert.match(r.text, /<link rel="canonical" href="https:\/\/openvibe\.space\/">/);
        assert.doesNotMatch(r.text, /href="\/s"/, 'nothing links a /s that only redirects');
    });

    await check('/updates is this site\'s own update log, and the footer links it', async () => {
        const r = await t.get('/updates');
        assert.strictEqual(r.status, 200);
        assert.ok(r.text.includes('What shipped on OpenVibe.Space'));
        assert.ok(r.text.includes('data-ov-shipped') && r.text.includes('data-service="space"'), 'the shared log, for space');
        const home = await t.get('/');
        assert.ok(!home.text.includes('openvibe.community/updates'), 'the footer no longer sends readers to the community\'s log');
    });

    await check('robots.txt points at the sitemap and keeps the private paths out', async () => {
        const r = await t.get('/robots.txt');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /Sitemap: https:\/\/openvibe\.space\/sitemap\.xml/);
        assert.match(r.text, /Disallow: \/api\//);
        assert.match(r.text, /Disallow: \/auth\//);
    });

    await check('llms.txt describes Space and sends the reader to the forum', async () => {
        const r = await t.get('/llms.txt');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /OpenVibe\.Space/);
        assert.match(r.text, /https:\/\/openvibe\.community\/s/);
        assert.doesNotMatch(r.text, /\/s\/feed\.xml/, 'no forum feed is advertised');
    });

    await check('the sitemap holds the home page and the spaces gallery (no published space yet)', async () => {
        const r = await t.get('/sitemap.xml');
        assert.strictEqual(r.status, 200);
        const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        assert.deepStrictEqual(locs, ['https://openvibe.space/', 'https://openvibe.space/spaces']);
        assert.strictEqual(assertSitemapLastmods(r.text).length, 2);
    });

    await check('health and readiness answer, and readiness names the store', async () => {
        const health = await t.get('/api/health');
        assert.strictEqual(health.status, 200);
        assert.strictEqual(health.json().service, 'openvibe-space');
        const ready = await t.get('/api/ready');
        assert.ok(ready.status >= 200 && ready.status < 300, `ready answered ${ready.status}`);
        const body = ready.json();
        assert.strictEqual(body.service, 'space');
        assert.strictEqual(body.checks.db.status, 'ok');
        // PGlite locally, PostgreSQL in CI (the containers): either is a real store.
        assert.ok(['pglite', 'postgresql'].includes(body.checks.db.detail.store), `store ${body.checks.db.detail.store}`);
    });

    await check('sign-in is mounted: /auth/me answers a guest, /auth/login sends the browser to the Network', async () => {
        const me = await t.get('/auth/me');
        assert.deepStrictEqual([me.status, me.json().user], [200, null]);
        const login = await t.get('/auth/login?next=/');
        assert.strictEqual(login.status, 302);
        assert.match(login.headers.get('location'), /^https?:\/\/127\.0\.0\.1:\d+\/oauth\/authorize/);
    });

    await check('a session token signs in; a typed Network token (a FedCM assertion, a realtime ticket, an export token) never does', async () => {
        const me = (token) => fetch(`${t.base}/auth/me`, { headers: { cookie: `ov_token=${token}` } });
        const claims = { id: 7, username: 'alex', subject_id: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPR' };
        assert.strictEqual((await me(t.network.sign(claims))).status, 200);
        for (const extra of [{ typ: 'fedcm', aud: 'space' }, { typ: 'realtime', purpose: 'realtime' }, { purpose: 'export' }]) {
            assert.strictEqual((await me(t.network.sign({ ...claims, ...extra }))).status, 401, JSON.stringify(extra));
        }
    });

    await check('there is no forum here: an unknown path is an honest 404 page', async () => {
        const r = await t.get('/nope');
        assert.strictEqual(r.status, 404);
        assert.match(r.text, /Page not found/);
    });

    await t.close();
    done();
})().catch((e) => { console.error(e); process.exitCode = 1; });
