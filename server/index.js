'use strict';

/**
 * OpenVibe.Space — process entry. `node server/index.js`
 * Listens on PORT (4940) behind nginx; see deploy/ for the unit and vhost.
 */
const config = require('./config');
const { createApp } = require('./app');
const { telemetry } = require('openvibe-sdk/service');
const { createPgTelemetrySink, startTelemetryRetention } = require('openvibe-sdk/telemetry');

(async () => {
    // PostgreSQL first (migrations run as the owner); readiness reports the serving database.
    await require('./db').initDb(config);
    const app = await createApp();
    const server = app.listen(config.port, config.host, () => {
        console.log(`[Space] ${config.nodeEnv} on http://${config.host}:${config.port} → ${config.baseUrl}`);
        console.log(`[Space] static hosting for staff; dynamic pages and spaces planned; the forum is on ${config.communityUrl}; identity via ${config.networkUrl}`);
    });
    server.keepAliveTimeout = 65_000;
    // Request telemetry (openvibe-sdk/service, plan T1): one aggregated sample per route template, method and status
    // class each minute, stored in this service's telemetry_samples table; rows older than 14 days go daily.
    telemetry.init({ service: 'space', sink: createPgTelemetrySink({ db: require('./db').getDb(), log: console }), skipPrefixes: ['/shared'], intervalMs: 60_000 });
    const telemetryRetention = startTelemetryRetention({ db: require('./db').getDb(), log: console, olderThanDays: 14 });
    app.locals.hosting.worker.start();
    app.locals.hosting.outbox.start();
    app.locals.hosting.billing.start();   // off unless SPACE_BILLING_INTERVAL_MS > 0

    // ── Stop (roadmap WS-P lifecycle; openvibe-sdk/service) ──────
    // SIGTERM: the server stops taking connections, closes idle keep-alive ones (it keeps them 65 s
    // otherwise) and lets requests in flight finish (4 s at most); then space.db closes and the
    // process exits 0, within the manifest's 5 s.
    const { gracefulStop } = require('openvibe-sdk/service');
    gracefulStop({
        name: 'Space', server,
        drainMs: 4000, deadlineMs: 5000, deadlineExitCode: 1,
        stop: [async () => { app.locals.hosting.worker.stop(); await app.locals.hosting.outbox.stop(); await app.locals.hosting.billing.stop(); }],
        close: [
            async () => { if (telemetryRetention) await telemetryRetention.stop(); await telemetry.stop(); },
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
