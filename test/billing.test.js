'use strict';
// Usage readings → Billing (plan T5 step 14, Space slice; server/billing.js, migrations/0006_billing_readings.sql).
// One closed UTC day aggregates into one gb-month reading per production (project, owner): that day's share of a
// GB-month (bytes / GB / days in the UTC month), each space_blobs row counted once. Sandbox, deleted and empty
// projects are never recorded; re-running a day inserts nothing; Media mode emits nothing; and at
// SPACE_BILLING_INTERVAL_MS=0 (the default) nothing runs.
const assert = require('assert');
const { testDb } = require('./helpers/db');
const { load } = require('../server/hosting-config');
const { createSpaceBilling, DAY_MS, GB, dayStart } = require('../server/billing');

const PRJ_A = 'prj_01JAB2C3D4E5F6G7H8J9K0AAAA';
const PRJ_B = 'prj_01JAB2C3D4E5F6G7H8J9K0BBBB';
const PRJ_SBX = 'prj_01JAB2C3D4E5F6G7H8J9K0SBX1';
const PRJ_DEL = 'prj_01JAB2C3D4E5F6G7H8J9K0DEL1';
const PRJ_EMPTY = 'prj_01JAB2C3D4E5F6G7H8J9K0EMP1';
const USR_A = 'usr_01JAB2C3D4E5F6G7H8J9K0AAA1';
const USR_B = 'usr_01JAB2C3D4E5F6G7H8J9K0BBB2';
const FIXED = Date.UTC(2026, 9, 4, 12, 0, 0);   // a fixed clock: nothing here depends on wall time
const iso = (ms) => new Date(ms).toISOString();
const sha = (n) => String(n).padStart(64, '0');
const silent = { log() {}, warn() {}, error() {} };

(async () => {
    const db = await testDb();
    try {
        const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
        const count = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM billing_readings').get()).n);
        const addProject = (id, owner, environment = 'production', status = 'active') => db.prepare(
            `INSERT INTO space_projects (id, owner_subject, name, environment, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)`)
            .run(id, owner, id, environment, status);
        const addBlob = (project, n, size) => db.prepare('INSERT INTO space_blobs (project_id, sha256, size, created_at) VALUES (?, ?, ?, 0)').run(project, sha(n), size);

        // 1. Off by default: no interval, no timer, nothing aggregated.
        const off = load({ NODE_ENV: 'test' });
        assert.strictEqual(off.billing.intervalMs, 0);
        assert.strictEqual(off.objectStore.mode, 'local');
        const idle = createSpaceBilling({ db, config: off, now: () => FIXED, log: silent });
        assert.strictEqual(idle.enabled, false);
        assert.strictEqual(idle.start(), false);
        assert.strictEqual(idle.running, false);
        assert.strictEqual(await count(), 0);
        await idle.stop();

        // 2. One closed UTC day → one reading per production (project, owner); each blob once; others out.
        await addProject(PRJ_A, USR_A);
        await addProject(PRJ_B, USR_B);
        await addProject(PRJ_SBX, USR_A, 'sandbox');
        await addProject(PRJ_DEL, USR_A, 'production', 'deleted');
        await addProject(PRJ_EMPTY, USR_B);
        await addBlob(PRJ_A, 1, 3 * GB);
        await addBlob(PRJ_A, 2, 1 * GB);
        await addBlob(PRJ_B, 1, GB / 2);                 // the same sha in another project is that project's copy
        await addBlob(PRJ_SBX, 3, 5 * GB);
        await addBlob(PRJ_DEL, 4, 7 * GB);
        await addBlob(PRJ_EMPTY, 5, 0);

        const config = load({ NODE_ENV: 'test', SPACE_BILLING_INTERVAL_MS: '60000' });
        assert.strictEqual(config.billing.intervalMs, 60000);
        assert.strictEqual(config.billing.audience, 'openvibe.billing');
        const billing = createSpaceBilling({ db, config, now: () => FIXED, log: silent });
        assert.strictEqual(billing.enabled, true);
        assert.strictEqual(billing.reporting, false, 'no OV_BILLING_URL: readings stay queued');

        const day = dayStart(FIXED) - 2 * DAY_MS;          // 2026-10-02, October has 31 days
        await assert.rejects(billing.aggregateStorageDay(dayStart(FIXED), { now: FIXED }), RangeError, 'today has not closed');
        await assert.rejects(billing.aggregateStorageDay(day + 1, { now: FIXED }), RangeError, 'not a day start');
        const first = await billing.aggregateStorageDay(day, { now: FIXED });
        assert.deepStrictEqual([first.readings, first.created], [2, 2]);

        const keyA = `space:store:${PRJ_A}:${USR_A}:local:${iso(day)}`;
        const keyB = `space:store:${PRJ_B}:${USR_B}:local:${iso(day)}`;
        const rows = await db.prepare('SELECT event_id, envelope, sent_at FROM billing_readings ORDER BY event_id').all();
        assert.deepStrictEqual(rows.map((r) => r.event_id), [keyA, keyB].sort());
        const a = json(rows.find((r) => r.event_id === keyA).envelope);
        assert.strictEqual(a.project, PRJ_A);
        assert.strictEqual(a.subject, USR_A);
        assert.strictEqual(a.resource, 'gb-month');
        assert.strictEqual(a.provider, 'local');
        assert.strictEqual(a.operation, 'store');
        assert.strictEqual(a.unit, 'GB');
        assert.strictEqual(a.at, iso(day));
        assert.ok(Math.abs(a.quantity - 4 / 31) < 1e-12, `4 GB for one October day: ${a.quantity}`);
        const b = json(rows.find((r) => r.event_id === keyB).envelope);
        assert.ok(Math.abs(b.quantity - 0.5 / 31) < 1e-12);
        const period = await db.prepare('SELECT readings FROM billing_periods WHERE metric = ? AND period_start = ?').get('gb-month', day);
        assert.strictEqual(Number(period.readings), 2);

        // 3. A closed day is aggregated once: a re-run (even after the store changed) inserts nothing.
        await addBlob(PRJ_A, 6, 9 * GB);
        const again = await billing.aggregateStorageDay(day, { now: FIXED });
        assert.deepStrictEqual([again.created, again.skipped], [0, true]);
        assert.strictEqual(await count(), 2);

        // 4. Media mode: Media bills the bytes, Space emits nothing and leaves the day unmarked.
        const media = createSpaceBilling({ db, config: load({ NODE_ENV: 'test', SPACE_BILLING_INTERVAL_MS: '60000', SPACE_OBJECT_STORE: 'media' }), now: () => FIXED, log: silent });
        assert.strictEqual(media.mediaMode, true);
        const mday = day - DAY_MS;
        const none = await media.aggregateStorageDay(mday, { now: FIXED });
        assert.deepStrictEqual([none.readings, none.created, none.skipped], [0, 0, 'media']);
        assert.strictEqual(await count(), 2);
        assert.strictEqual(await db.prepare('SELECT 1 FROM billing_periods WHERE period_start = ?').get(mday), undefined);
        assert.strictEqual((await media.tick()).created, 0, 'the Media-mode tick aggregates nothing');
        await media.stop();

        // 5. The tick aggregates the newest closed day (2026-10-03) and, with no Billing URL, keeps it queued.
        const ticked = await billing.tick();
        assert.ok(ticked, 'the tick never throws');
        assert.strictEqual(ticked.created, 2);
        assert.strictEqual(Number((await db.prepare('SELECT COUNT(*) AS n FROM billing_readings WHERE sent_at IS NULL').get()).n), 4);
        assert.ok(await db.prepare('SELECT 1 FROM billing_readings WHERE event_id = ?').get(`space:store:${PRJ_A}:${USR_A}:local:${iso(day + DAY_MS)}`));
        assert.strictEqual((await billing.status()).last_error, null);
        await billing.stop();
        console.log('billing: passed');
    } finally {
        await db.close();
    }
})().catch((err) => { console.error(err); process.exitCode = 1; });
