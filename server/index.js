'use strict';

/**
 * OpenVibe.Space — process entry. `node server/index.js`
 * Listens on PORT (4940) behind nginx; see deploy/ for the unit and vhost.
 */
const config = require('./config');
const { createApp } = require('./app');

(async () => {
    // PostgreSQL first (migrations run as the owner). Space holds no user content yet, but the
    // database carries the shared schema and the readiness check reports it.
    await require('./db').initDb(config);
    const app = await createApp();
    const server = app.listen(config.port, config.host, () => {
        console.log(`[Space] ${config.nodeEnv} on http://${config.host}:${config.port} → ${config.baseUrl}`);
        console.log(`[Space] code and dynamic pages (nothing published here yet); the forum is on ${config.communityUrl}; identity via ${config.networkUrl}`);
    });
    server.keepAliveTimeout = 65_000;

    // ── Stop (roadmap WS-P lifecycle; openvibe-sdk/service) ──────
    // SIGTERM: the server stops taking connections, closes idle keep-alive ones (it keeps them 65 s
    // otherwise) and lets requests in flight finish (4 s at most); then space.db closes and the
    // process exits 0, within the manifest's 5 s.
    const { gracefulStop } = require('openvibe-sdk/service');
    gracefulStop({
        name: 'Space', server,
        drainMs: 4000, deadlineMs: 5000, deadlineExitCode: 1,
        stop: [],
        close: [
            async () => {
                console.log('[Space] stopped');
                return await require('./db').closeDb();
            },
        ],
    });
})().catch((err) => {
    console.error('[Space] failed to start:', err);
    process.exit(1);
});
