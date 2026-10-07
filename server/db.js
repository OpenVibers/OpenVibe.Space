'use strict';

/**
 * Space's own database: PostgreSQL (ADR-035). The schema is migrations/NNNN_*.sql, applied at boot.
 *
 * Space owns the forum: space groups, spaces, categories, threads, posts and their versions, thread
 * votes, attachments (Media objects), post reactions, a space's chat room, per-space moderators, the
 * Discord relay's bookkeeping and the account-data and block projections. People are referenced by
 * Network subject ids (usr_… / gst_…), never by a service-local integer; subject_projection is only a
 * display cache of what the Network says about them.
 *
 * Pastes, typed comment threads, Pulse and submissions are OpenVibe.Community's; they are not here.
 *
 * Timestamps are text ('YYYY-MM-DD HH:MM:SS', UTC): the schema defines ov_now(), datetime() and julianday()
 * with those semantics, and ov_hot() for the forum's hot rank.
 */
const fs = require('fs');
const path = require('path');
const { createDb } = require('openvibe-sdk/db');

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const DEV_PGLITE = path.join(__dirname, '..', 'data', 'pglite');

/**
 * The serving handle (ADR-035): DATABASE_URL through PgBouncer; in development without it, an embedded PGlite database
 * in data/pglite. Migrations run first, as the owner (DATABASE_DIRECT_URL), or on the embedded handle.
 */
async function openDb(config, { log = console, registry } = {}) {
    if (!config.db.url) {
        if (config.isProduction) throw new Error('DATABASE_URL is not set: production serves from PostgreSQL (OpenVibe.Host roles/data add-service.sh space)');
        const dir = process.env.SPACE_PGLITE_DIR || DEV_PGLITE;   // tests that boot the real server give it a directory of its own
        log.warn(`[Space] DATABASE_URL unset: embedded PGlite database in ${dir} (development only, one process)`);
        fs.mkdirSync(dir, { recursive: true });
        const db = createDb({ pglite: dir, service: 'space', registry, log });
        await db.migrate({ dir: MIGRATIONS, log });
        return db;
    }
    if (!config.db.directUrl) throw new Error('DATABASE_DIRECT_URL is not set: migrations run with the owner role on a direct connection');
    const owner = createDb({ url: config.db.directUrl, service: 'space-migrate', max: 1, log });
    try { await owner.migrate({ dir: MIGRATIONS, log }); } finally { await owner.close(); }
    return createDb({ url: config.db.url, service: 'space', registry, log });
}

let _shared = null;
/** Open the process-wide database once, at boot (server/index.js). */
async function initDb(config, opts) {
    if (!_shared) _shared = await openDb(config, opts);
    return _shared;
}
/** The process-wide database initDb() opened. */
function getDb() {
    if (!_shared) throw new Error('the database is not open: await initDb(config) at boot');
    return _shared;
}
/** Tests: use this handle as the process-wide database. */
function setDb(db) { _shared = db; }

/** Graceful stop: close the process-wide database. */
async function closeDb() {
    const db = _shared;
    _shared = null;
    if (db) await db.close().catch(() => {});
}

module.exports = { openDb, initDb, getDb, setDb, closeDb, MIGRATIONS };
