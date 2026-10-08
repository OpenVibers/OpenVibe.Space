'use strict';
/**
 * Track O: truthful readiness for GET /api/ready (openvibe-shared/ready).
 *
 *   db              required  a real query on Space's PostgreSQL database (the schema is there and answers)
 *   network_jwks    optional  the Network signing key has loaded. Without it the home page and the
 *                             discovery files still work, but nobody can sign in, so it degrades
 *                             rather than fails
 *
 * Request metrics come from openvibe-shared/metrics in app.js.
 */
const { createReadiness } = require('openvibe-shared/ready');

function createSpaceReadiness({ db, auth, config, release = null } = {}) {
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
                if (auth.client.publicKey) return true;
                // Not loaded: ask again (ensureKey throttles itself to one fetch per 30 s) and report now.
                auth.ensureKey().catch(() => {});
                return 'Network signing key not loaded yet: sign-in is unavailable';
            },
        },
    ];
    return createReadiness({ service: 'space', release, checks });
}

module.exports = { createSpaceReadiness };
