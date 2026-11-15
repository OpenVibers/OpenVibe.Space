'use strict';
/**
 * A person's live sites, public (plan §AD.10 step 6): GET /api/v1/people/:subject/sites lists the sites in the person's
 * own projects that anyone can open now, newest deploy first, without sign-in; never a scratch site, a site with no
 * live deploy, a deleted site, a site taken down or someone else's.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { testDb } = require('./helpers/db');
const { createApp } = require('../server/app');
const { load } = require('../server/hosting-config');

const KIM = 'usr_01J8ZQ4Y7N3M2K1H0G9F8E7D6C';
const LEE = 'usr_01J8ZQ4Y7N3M2K1H0G9F8E7D6D';

(async () => {
    const db = await testDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-space-people-'));
    let server = null;
    try {
        const auth = { verify: async () => null, keys: { loaded: () => false } };
        const config = load({ NODE_ENV: 'test', BASE_URL: 'https://openvibe.space', SPACE_WORKER: 'off', SPACE_MIN_FREE_BYTES: '0' });
        const app = await createApp({ db, auth, hostingConfig: config, storageDir: dir });
        const h = app.locals.hosting;
        const kim = { kind: 'user', subject: KIM, staff: true };
        const lee = { kind: 'user', subject: LEE, staff: true };
        const page = (html) => [{ path: 'index.html', data: Buffer.from(html) }];
        const live = async (who, project, name) => {
            const site = await h.sites.create(who, project, { name });
            await h.deploys.create(who, await h.deploys.precheck(who, site.id), page(`<h1>${name}</h1>`), { source: 'files', activate: true });
            return site;
        };
        const mine = await h.projects.create(kim, { name: 'Mine' });
        await live(kim, mine, 'kim-recipes');
        await live(kim, mine, 'kim-portfolio');
        await h.sites.create(kim, mine, { name: 'kim-empty' });                     // never deployed
        const gone = await live(kim, mine, 'kim-gone');
        await h.sites.remove(kim, gone.id, { deploys: h.deploys });
        const down = await live(kim, mine, 'kim-down');
        await h.takedowns.takeDown(kim, 'site', down.id, 'test');
        const scratch = await live(kim, mine, 'kim-scratch');
        await db.prepare('UPDATE space_sites SET scratch = true WHERE id = ?').run(scratch.id);
        const theirs = await h.projects.create(lee, { name: 'Theirs' });
        await live(lee, theirs, 'lee-site');

        server = http.createServer(app).listen(0, '127.0.0.1');
        await new Promise((ok) => server.once('listening', ok));
        const get = (p) => new Promise((resolve, reject) => {
            http.get({ host: '127.0.0.1', port: server.address().port, path: p, headers: { host: 'openvibe.space', accept: 'application/json' } }, (res) => {
                let text = '';
                res.on('data', (c) => { text += c; });
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
            }).on('error', reject);
        });

        const r = await get(`/api/v1/people/${KIM}/sites`);
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        assert.strictEqual(r.headers['access-control-allow-origin'], '*');
        assert.match(r.headers['cache-control'], /public, max-age=60/);
        assert.deepStrictEqual(r.json.sites.map((s) => s.name), ['kim-portfolio', 'kim-recipes'], 'live sites only, newest first');
        assert.deepStrictEqual(Object.keys(r.json.sites[0]).sort(), ['hostname', 'name', 'updated_at', 'url']);
        assert.strictEqual(r.json.sites[0].url, 'https://kim-portfolio.openvibe.website/');
        assert.ok(!Number.isNaN(Date.parse(r.json.sites[0].updated_at)));

        assert.deepStrictEqual((await get(`/api/v1/people/${LEE}/sites`)).json.sites.map((s) => s.name), ['lee-site'], 'each person their own');
        assert.deepStrictEqual((await get('/api/v1/people/usr_01J8ZQ4Y7N3M2K1H0G9F8E7D6E/sites')).json.sites, [], 'a person with none');
        assert.strictEqual((await get('/api/v1/people/kim/sites')).status, 404, 'a subject, not a name');
        assert.strictEqual((await get('/api/v1/projects')).status, 401, 'the rest of the API still needs sign-in');
        console.log('people-sites: a person\'s live sites, public, newest first');
    } finally {
        if (server) server.close();
        await db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch((err) => { console.error(err); process.exitCode = 1; });
