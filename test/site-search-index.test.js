'use strict';
/**
 * Live sites in OpenVibe.Search (plan §AD.10 step 6): every site anyone can open now is one document (owner space,
 * type site) with its index.html's title, description and visible text; never a scratch site, a sandbox project's, a
 * site taken down or a page that asks not to be indexed; an unchanged site is not re-sent, a changed one goes one
 * revision up, and a site that stops being live is tombstoned.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { testDb } = require('./helpers/db');
const { createApp } = require('../server/app');
const { load } = require('../server/hosting-config');
const { createSiteSearchIndex, wordsOf } = require('../server/search-index');

const KIM = 'usr_01J8ZQ4Y7N3M2K1H0G9F8E7D6C';

(async () => {
    // The words of a page: no script, style or markup, entities decoded.
    const w = wordsOf(`<!doctype html><html><head><title>Kim&#39;s &amp; Recipes</title><meta content="Soups &amp; bread" name="description">
        <style>body{color:red}</style></head><body><h1>Soup</h1><script>var secret = 1;</script><p>Warm&nbsp;and   good.</p><!-- hidden --></body></html>`);
    assert.deepStrictEqual(w, { title: "Kim's & Recipes", description: 'Soups & bread', text: 'Soup Warm and good.', noindex: false });
    assert.strictEqual(wordsOf('<meta name="robots" content="noindex, nofollow"><p>x</p>').noindex, true);

    const db = await testDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-space-search-'));
    const docs = new Map();   // id → { revision, deleted, document }
    const search = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
        assert.strictEqual(req.headers.authorization, 'Bearer space-token');
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            if (req.method === 'GET' && u.pathname === '/api/v1/owners/space/documents') return send(200, { documents: [...docs].map(([id, d]) => ({ type: 'site', id, revision: d.revision, deleted: d.deleted })) });
            const one = /^\/api\/v1\/owners\/space\/documents\/site\/([^/]+)$/.exec(u.pathname);
            if (req.method === 'GET' && one) { const d = docs.get(decodeURIComponent(one[1])); return d ? send(200, { document: d.document }) : send(404, {}); }
            const put = /^\/api\/v1\/documents\/space\/site\/([^/]+)$/.exec(u.pathname);
            if (put && req.method === 'PUT') { const doc = JSON.parse(body); docs.set(decodeURIComponent(put[1]), { revision: doc.revision, deleted: false, document: doc }); return send(200, { outcome: 'indexed' }); }
            if (put && req.method === 'DELETE') { const d = docs.get(decodeURIComponent(put[1])); d.deleted = true; d.revision = Number(u.searchParams.get('revision')); return send(200, { outcome: 'deleted' }); }
            return send(404, {});
        });
    });
    await new Promise((ok) => search.listen(0, '127.0.0.1', ok));
    try {
        const auth = { verify: async () => null, keys: { loaded: () => false } };
        const config = load({ NODE_ENV: 'test', BASE_URL: 'https://openvibe.space', SPACE_WORKER: 'off', SPACE_MIN_FREE_BYTES: '0', SPACE_SEARCH_URL: `http://127.0.0.1:${search.address().port}` });
        const app = await createApp({ db, auth, hostingConfig: config, storageDir: dir });
        const h = app.locals.hosting;
        assert.strictEqual(h.searchIndex.enabled, false, 'off without the client secret');
        const kim = { kind: 'user', subject: KIM, staff: true };
        const deploy = async (site, html) => h.deploys.create(kim, await h.deploys.precheck(kim, site.id), [{ path: 'index.html', data: Buffer.from(html) }], { source: 'files', activate: true });
        const mine = await h.projects.create(kim, { name: 'Mine' });
        const recipes = await h.sites.create(kim, mine, { name: 'kim-recipes' });
        await deploy(recipes, '<title>Kim Recipes</title><meta name="description" content="Soups and bread"><body><h1>Soup</h1><p>Warm and good.</p></body>');
        const hidden = await h.sites.create(kim, mine, { name: 'kim-hidden' });
        await deploy(hidden, '<meta name="robots" content="noindex"><p>Not for search</p>');
        const scratch = await h.sites.create(kim, mine, { name: 'kim-scratch' });
        await deploy(scratch, '<p>Scratch</p>');
        await db.prepare('UPDATE space_sites SET scratch = true WHERE id = ?').run(scratch.id);
        const down = await h.sites.create(kim, mine, { name: 'kim-down' });
        await deploy(down, '<p>Down</p>');
        await h.takedowns.takeDown(kim, 'site', down.id, 'test');

        const index = createSiteSearchIndex({ db, blobs: h.blobs, sites: h.sites, takedowns: h.takedowns, config, tokens: { authHeaders: async () => ({ Authorization: 'Bearer space-token' }) } });
        assert.strictEqual(index.enabled, true);
        let out = await index.run();
        assert.deepStrictEqual([out.upserted, out.failed], [1, 0], JSON.stringify(out));
        assert.deepStrictEqual([...docs.keys()], [recipes.id], 'only the live, public, indexable site');
        const doc = docs.get(recipes.id).document;
        assert.deepStrictEqual([doc.canonical_url, doc.title, doc.summary, doc.visibility, doc.publication_state, doc.revision], ['https://kim-recipes.openvibe.website/', 'Kim Recipes', 'Soups and bread', 'public', 'published', 1]);
        assert.ok(doc.body.includes('Warm and good.'));
        assert.deepStrictEqual(doc.facets, { kind: 'website', host: 'kim-recipes.openvibe.website' });

        out = await index.run();
        assert.strictEqual(out.unchanged, 1, 'an unchanged site is not re-sent');
        await deploy(recipes, '<title>Kim Recipes</title><body><p>Now with pie.</p></body>');
        await index.run();
        assert.deepStrictEqual([docs.get(recipes.id).revision, docs.get(recipes.id).document.summary], [2, 'Now with pie.'], 'a new deploy goes one revision up');

        await h.sites.remove(kim, recipes.id, { deploys: h.deploys });
        out = await index.run();
        assert.deepStrictEqual([out.deleted, docs.get(recipes.id).deleted, docs.get(recipes.id).revision], [1, true, 3], 'a site that stops being live is tombstoned');
        console.log('site-search-index: live sites are search documents, kept current and tombstoned');
    } finally {
        search.close();
        await db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch((err) => { console.error(err); process.exitCode = 1; });
