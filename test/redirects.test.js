'use strict';
/**
 * The forum is OpenVibe.Community's again (owner decision, 2026-10-08), so every forum URL here is a
 * permanent redirect to the same path and query on openvibe.community: /s and /s/* answer 301 for
 * GET and HEAD (the method is kept) and 308 for anything else, and the forum APIs always answer 308.
 * Everything that is not a forum path stays on Space.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/app');

const COMMUNITY = 'https://openvibe.community';

(async () => {
    const t = await boot();

    await check('GET and HEAD of /s and its nested paths answer 301 to Community, path and query intact', async () => {
        for (const path of ['/s', '/s?sort=new', '/s/general', '/s/general/t/123?x=1&y=two', '/s/feed.xml', '/s/general/feed.xml']) {
            const r = await t.get(path);
            assert.strictEqual(r.status, 301, path);
            assert.strictEqual(r.headers.get('location'), `${COMMUNITY}${path}`, path);
        }
        const head = await t.get('/s?sort=top', { method: 'HEAD' });
        assert.strictEqual(head.status, 301);
        assert.strictEqual(head.headers.get('location'), `${COMMUNITY}/s?sort=top`);
    });

    await check('other methods of /s and /s/* answer 308 (the method and body are preserved)', async () => {
        const post = await t.get('/s/general/threads?q=1', { method: 'POST', body: 'title=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        assert.strictEqual(post.status, 308);
        assert.strictEqual(post.headers.get('location'), `${COMMUNITY}/s/general/threads?q=1`);
        const del = await t.get('/s/general/t/123/posts/9', { method: 'DELETE' });
        assert.strictEqual(del.status, 308);
        assert.strictEqual(del.headers.get('location'), `${COMMUNITY}/s/general/t/123/posts/9`);
    });

    await check('the forum APIs answer 308 to Community, path and query intact', async () => {
        for (const path of ['/api/v1/spaces', '/api/v1/spaces/general/threads?sort=top', '/api/v1/posts', '/api/v1/posts/42', '/api/v1/space-groups', '/api/v1/space-groups/2', '/api/v1/relay', '/api/v1/relay/status']) {
            const r = await t.get(path);
            assert.strictEqual(r.status, 308, path);
            assert.strictEqual(r.headers.get('location'), `${COMMUNITY}${path}`, path);
        }
        const post = await t.get('/api/v1/spaces/general/threads', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
        assert.strictEqual(post.status, 308, 'a write is never replayed as a GET');
    });

    await check('only the forum paths redirect: the home page, the sitemap, /shared and the session stay here', async () => {
        assert.strictEqual((await t.get('/')).status, 200);
        assert.strictEqual((await t.get('/sitemap.xml')).status, 200);
        assert.strictEqual((await t.get('/robots.txt')).status, 200);
        assert.strictEqual((await t.get('/auth/me')).status, 200);
        assert.strictEqual((await t.get('/api/health')).status, 200);
        const shared = await t.get('/shared/navbar.js');
        assert.notStrictEqual(shared.status, 301, '/shared is not a forum path');
        assert.notStrictEqual(shared.status, 308);
    });

    await t.close();
    done();
})().catch((e) => { console.error(e); process.exitCode = 1; });
