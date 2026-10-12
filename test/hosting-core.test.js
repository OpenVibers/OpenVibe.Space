'use strict';
/** Socket-free Stage B smoke test against Space's full migrated PGlite schema. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { testDb } = require('./helpers/db');
const { createApp } = require('../server/app');
const { load } = require('../server/hosting-config');

(async () => {
    const db = await testDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-space-core-'));
    try {
        const auth = { verify: async () => null, keys: { loaded: () => false } };
        const config = load({ NODE_ENV: 'test', BASE_URL: 'https://openvibe.space', SPACE_WORKER: 'off', SPACE_MIN_FREE_BYTES: '0' });
        assert.strictEqual(config.publicHosting, false);
        assert.strictEqual(config.sitesDomain, 'openvibe.website');
        const app = await createApp({ db, auth, hostingConfig: config, storageDir: dir });
        const h = app.locals.hosting;
        const user = { kind: 'user', subject: 'usr_01J8ZQ4Y7N3M2K1H0G9F8E7D6C', staff: false };
        await assert.rejects(h.projects.create(user, { name: 'Blocked' }), (e) => e.status === 403 && e.code === 'space.not_launched');
        user.staff = true;
        const project = await h.projects.create(user, { name: 'Trial' });
        const site = await h.sites.create(user, project, { name: 'trial-site' });
        assert.strictEqual((await h.tenant.resolve('trial-site.openvibe.website')).kind, 'site');
        assert.strictEqual((await h.tenant.resolve('trial-site.openvibe.space')).kind, 'unknown');
        const pre = await h.deploys.precheck(user, site.id);
        const first = await h.deploys.create(user, pre, [{ path: 'index.html', data: Buffer.from('<h1>First</h1>') }], { source: 'files', activate: true });
        assert.strictEqual(first.deploy.state, 'ready');
        assert.strictEqual(first.activated.changed, true);
        const second = await h.deploys.create(user, await h.deploys.precheck(user, site.id), [{ path: 'index.html', data: Buffer.from('<h1>Second</h1>') }], { source: 'files', activate: true });
        assert.notStrictEqual(first.deploy.manifest_sha256, second.deploy.manifest_sha256);
        const switched = await h.deploys.activate(user, first.deploy.id, { expectedActive: second.deploy.id });
        assert.strictEqual(switched.deploy_id, first.deploy.id);
        assert.strictEqual((await h.sites.get(site.id)).active_deploy_id, first.deploy.id);
        const rows = await db.prepare('SELECT envelope FROM event_outbox ORDER BY id').all();
        const types = rows.map((r) => (typeof r.envelope === 'string' ? JSON.parse(r.envelope) : r.envelope).event_type);
        for (const row of rows) {
            const envelope = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
            assert.strictEqual(require('openvibe-contracts').validate('events.event-envelope@1', envelope).valid, true);
            assert.strictEqual(require('openvibe-contracts').validate(`${envelope.event_type}@1`, envelope.payload).valid, true, envelope.event_type);
        }
        assert.deepStrictEqual(types, ['space.deploy.created', 'space.deploy.activated', 'space.deploy.created', 'space.deploy.activated', 'space.deploy.activated']);
        console.log('hosting-core: passed');
    } finally {
        await db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch((err) => { console.error(err); process.exitCode = 1; });
