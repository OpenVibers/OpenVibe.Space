'use strict';
/** Space discovery describes staff static hosting without listing tenant or private pages. */
const assert = require('assert');
const { boot, check, done, DASHBOARD } = require('./stageb/boot');

(async () => {
    const t = await boot();
    await check('llms documents describe Space and omit tenant pages', async () => {
        for (const file of ['/llms.txt', '/llms-full.txt']) {
            const r = await t.get(DASHBOARD, file);
            assert.strictEqual(r.status, 200);
            assert.match(r.headers['content-type'], /^text\/plain/);
            assert.match(r.text, /OpenVibe.Space/);
            assert.match(r.text, /OpenVibe.Community/);
            assert.doesNotMatch(r.text, /\/preview\/|\/dashboard\/|\/api\/v1\/projects/);
        }
    });
    await check('the public page and sitemap stay on Space', async () => {
        const r = await t.get(DASHBOARD, '/');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /Immutable, content-addressed deploys with one-step rollback/);
        assert.match(r.text, /<link rel="canonical" href="https:\/\/openvibe\.space\/">/);
        const map = await t.get(DASHBOARD, '/sitemap.xml');
        assert.strictEqual(map.status, 200);
        assert.deepStrictEqual([...map.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), ['https://openvibe.space/', 'https://openvibe.space/spaces']);
    });
    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
