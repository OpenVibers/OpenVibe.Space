'use strict';
/**
 * Track O: truthful readiness for GET /api/ready (openvibe-shared/ready).
 *
 *   db              required  a real query on Space's PostgreSQL database (the schema is there and answers)
 *   network_jwks    optional  the Network signing key has loaded. Without it the home page and the
 *                             discovery files still work, but nobody can sign in, so it degrades
 *                             rather than fails
 *   storage         required  the hosting object store directory is writable (uploads and serving need it)
 *   disk_headroom   optional  free space above SPACE_MIN_FREE_BYTES; below it only new deploys are refused
 *   valkey          optional  per-actor limits are shared across processes
 *   events_relay    optional  the outbox relay is configured and has no rejected rows
 *   domain_checks   optional  no custom domain is stuck: pending checks are running
 *
 * Request metrics come from openvibe-shared/metrics in app.js.
 */
const { createReadiness } = require('openvibe-shared/ready');

function createSpaceReadiness({ db, auth, config, release = null, hosting = null } = {}) {
    const checks = [
        {
            name: 'db', required: true,
            // A real round trip that names the store (postgresql / pglite), and a migrated schema.
            check: async () => {
                const r = await db.ready();
                if (!r.ok) return r.error;
                const n = (await db.prepare('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema()').get()).n;
                return n > 0 ? { ok: true, detail: r.detail } : 'database has no tables (migrations did not run)';
            },
        },
        {
            name: 'network_jwks', required: false,
            check: () => {
                if (auth.keys.loaded()) return true;
                // Not loaded: createNetworkKeys retries every 30 s on its own; report now.
                return 'Network signing key not loaded yet: sign-in is unavailable';
            },
        },
    ];
    if (hosting) checks.push(...hostingChecks(hosting));
    return createReadiness({ service: 'space', release, checks });
}

/** The hosting engine's checks (moved from OpenVibe.Host with the engine, T20). */
function hostingChecks({ blobs, outbox, store, config, valkey }) {
    return [
        { name: 'storage', required: true, check: () => blobs.writable() },
        {
            // Serving goes on; only new deploys are refused below the floor.
            name: 'disk_headroom', required: false,
            check: () => {
                const free = blobs.freeBytes();
                const floor = config.uploads.minFreeBytes;
                return free >= floor ? { ok: true, detail: { free_bytes: free } } : `${free} bytes free, below SPACE_MIN_FREE_BYTES (${floor}): new deploys are refused`;
            },
        },
        { name: 'valkey', required: false, check: async () => (valkey ? valkey.ready() : { skipped: 'VALKEY_URL not set: per-actor limits count in this process only' }) },
        {
            name: 'events_relay', required: false,
            check: async () => {
                const s = await outbox.status();
                if (!s.enabled) return `relay off (Events URL or service credentials not configured); ${s.pending} events waiting`;
                if (s.rejected) return `${s.rejected} events rejected by OpenVibe.Events`;
                return { ok: true, detail: { pending: s.pending } };
            },
        },
        {
            name: 'domain_checks', required: false,
            check: async () => {
                const stale = (await store.db.prepare("SELECT COUNT(*) AS n FROM space_domains WHERE kind = 'custom' AND status = 'pending' AND COALESCE(last_checked_at, created_at) < ?").get(store.now() - 3600 * 1000)).n;
                return stale ? `${stale} pending custom domains not checked in the last hour (is the worker on?)` : true;
            },
        },
    ];
}

module.exports = { createSpaceReadiness };
