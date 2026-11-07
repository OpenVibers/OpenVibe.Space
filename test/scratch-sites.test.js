'use strict';
/**
 * Agent Streams S6 — the throwaway scratch sites (server/scratch-sites.js).
 *
 * A chat plays run leaves a scratch site behind. It is removed after 24 hours unless the owner keeps it,
 * and the cleanup job removes the ones whose day is up.
 */
const assert = require('assert');
const { testDb } = require('./helpers/db');
const { createScratchSites, SCRATCH_TTL_MS } = require('../server/scratch-sites');

(async () => {
    const db = await testDb();
    let now = 1_700_000_000_000;
    const store = { db, now: () => now };
    const scratch = createScratchSites({ store, config: {} });

    await db.prepare("INSERT INTO space_projects (id, owner_subject, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run('prj_test', 'usr_01JAB2C3D4E5F6G7H8J9K0MNPQ', 'Test', now, now);
    await db.prepare("INSERT INTO space_sites (id, project_id, name, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)")
        .run('site_test', 'prj_test', 'snake-4f2a', 'usr_01JAB2C3D4E5F6G7H8J9K0MNPQ', now, now);

    // A site becomes a scratch site: it is removed after a day.
    const marked = await scratch.mark('site_test');
    assert.strictEqual(marked.ok, true);
    assert.strictEqual(marked.expires_at - now, SCRATCH_TTL_MS);
    let row = await db.prepare('SELECT * FROM space_sites WHERE id = ?').get('site_test');
    assert.strictEqual(row.scratch, true);
    assert.strictEqual(row.scratch_kept, false);

    // The day is not up yet: nothing is removed.
    now += 60_000;
    assert.strictEqual(await scratch.removeExpired(), 0);
    row = await db.prepare('SELECT * FROM space_sites WHERE id = ?').get('site_test');
    assert.strictEqual(row.status, 'active');

    // The day is up: the site goes.
    now += SCRATCH_TTL_MS;
    assert.strictEqual(await scratch.removeExpired(), 1);
    row = await db.prepare('SELECT * FROM space_sites WHERE id = ?').get('site_test');
    assert.strictEqual(row.status, 'deleted', 'the scratch site is removed after 24 hours');

    // A kept site stays.
    await db.prepare("INSERT INTO space_sites (id, project_id, name, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)")
        .run('site_kept', 'prj_test', 'snake-kept', 'usr_1', now, now);
    await scratch.mark('site_kept');
    await scratch.keep('site_kept');
    now += SCRATCH_TTL_MS * 2;
    assert.strictEqual(await scratch.removeExpired(), 0, 'a kept site is not removed');
    row = await db.prepare('SELECT * FROM space_sites WHERE id = ?').get('site_kept');
    assert.strictEqual(row.status, 'active');
    assert.strictEqual(row.scratch_kept, true);

    console.log('scratch sites: a throwaway site lives 24 hours unless the owner keeps it');
    await db.close();
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
