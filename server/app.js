'use strict';

/**
 * OpenVibe.Space — the forums of OpenVibe.
 *
 * Express app factory (server/index.js listens; tests build their own instance).
 *
 *   Pages (server-rendered)              API / machine
 *   GET /s          the board index      /api/v1/spaces/*        spaces, threads, posts, votes,
 *   GET /s/:space   one space's topics   /api/v1/posts/*         categories, moderators (forum/api.js)
 *   GET /s/:space/t/:slug   one thread   /api/v1/space-groups/*  the board index's groups
 *   GET /s/:space/new       start one    /api/v1/relay/*         Discord relay admin (relay/api.js)
 *   GET /s/feed.xml, /s/:space/feed.xml  GET /api/health, /api/ready, /release.json, /metrics (loopback)
 *   POST /s/…/reply | /vote | /state | … GET /robots.txt, /llms.txt, /llms-full.txt, /sitemap.xml
 *   GET /auth/login|callback|logout|me|refresh    POST /internal/events (signed Events deliveries)
 *
 * The forum lives in Space's own database (spaces, threads, posts, votes, attachments). People are
 * OpenVibe.Network subjects; images are OpenVibe.Media objects; members-only spaces and threads are
 * OpenVibe.VIP; a space's chat room is OpenVibe.Chat. Pastes, typed comment threads, submissions and
 * the network Pulse feed stay on OpenVibe.Community, the hub.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const discovery = require('./discovery');
const { assetVersion, SITE_NAME } = require('./render/layout');
const { createAuthClient, createAuthRoutes } = require('./auth/routes');
const { getDb } = require('./db');
const { createNetworkIdentity } = require('./identity/network');
const { createViewerResolver } = require('./identity/viewer');
const { createForumService } = require('./forum/service');
const { createVipGate } = require('./vip');
const { createSpacesApi, createPostsApi, createGroupsApi } = require('./forum/api');
const { createForumRoutes } = require('./forum/routes');
const { createDiscordRelay } = require('./relay/discord');
const { createRelayEventsWorker } = require('./relay/events-worker');
const { createDiscordGateway } = require('./relay/discord-gateway');
const { createDiscordInbound } = require('./relay/inbound');
const { createRelayApi } = require('./relay/api');
const { createActorLimits } = require('./actor-limits');
const { createIndexNow } = require('openvibe-shared/indexnow');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
// Pages are rendered for the person reading them (and a form post redirects back to them), so no
// shared or browser cache keeps one.
const PAGE_CACHE = cache.htmlHeaders({ private: true });

async function createApp(opts = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    // What this server runs (ADR-016); the shared navbar's release-watch polls it.
    const release = require('openvibe-shared/release').createRelease({ service: 'space', root: require('path').join(__dirname, '..') });
    require('./render/layout').setRelease(release.release);
    // HTTP golden signals by route template, process metrics, release_info; GET /metrics answers
    // direct loopback callers only (Track O). Request metrics only: no content counts.
    const metrics = require('openvibe-shared/metrics').instrument(app, { service: 'space', release: release.release });
    app.locals.metrics = metrics.registry;

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                // Shared chrome (theme-loader, navbar, footer, history, ov-mark) comes from the Network.
                // Cloudflare Web Analytics: Cloudflare injects its beacon at the edge and the privacy text says it may
                // measure performance; script-src loads the beacon, connect-src is where it reports.
                scriptSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://cdnjs.cloudflare.com', 'https://static.cloudflareinsights.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com', 'https://openvibe.network'],
                fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
                // Attachments serve from openvibe.media (which may 302 to object storage); avatars from Network/Live.
                imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
                connectSrc: ["'self'", 'https://openvibe.network', 'https://openvibe.events', 'https://openvibe.media', 'https://openvibe.chat', 'https://openvibe.vip', 'https://cloudflareinsights.com'],
                // The Network's hidden /sso/check frame: how a visitor who is signed in elsewhere gets signed in here.
                frameSrc: ["'self'", 'https://openvibe.network'],
                frameAncestors: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'", 'https://openvibe.network'],
                scriptSrcAttr: ["'unsafe-inline'"],
            },
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }));
    app.use(cookieParser());

    // ── Auth (OAuth2 client of OpenVibe.Network) ─────────────
    const auth = opts.auth || createAuthClient(config);
    app.locals.auth = auth;
    app.locals.config = config;
    app.use('/auth/', rateLimit({ windowMs: 15 * 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));
    app.use('/auth', createAuthRoutes(config, auth));
    { const legal = require('openvibe-shared/legal'); app.get(legal.PATHS, legal.handler({ id: 'space', service: 'space', host: 'openvibe.space', name: 'OpenVibe.Space', profile: 'ugc' })); app.get('/tos', (_req, res) => res.redirect(301, '/terms')); }

    // ── Space's database, identity, and what lives in it ─────
    const db = opts.db || getDb();
    const network = opts.network || createNetworkIdentity({ config, db });
    // Network's per-person token cutoffs (network.user.token_valid_after): sign out everywhere, password
    // changes and bans refuse older tokens here at once (WS-B task 4).
    // Cutoffs are read into memory before the app serves: isRevoked() is synchronous on every signed-in request.
    const revocations = require('openvibe-sdk/auth').createPgRevocationStore(db, { table: 'token_revocations' });
    await revocations.load();
    const viewers = createViewerResolver({ auth, config, network, revocations });
    const relay = opts.relay || createDiscordRelay({
        db, config, enabled: config.discordRelay.enabled,
        pollMs: config.discordRelay.pollMs, baseMs: config.discordRelay.backoffMs, maxAttempts: config.discordRelay.maxAttempts,
        webhookVars: config.discordRelay.webhookVars,
        ...(opts.relayOptions || {}),
    });
    // Its Events worker (creates from space.thread.* / space.post.*) and the inbound gateway;
    // both off unless configured (relay/events-worker.js, relay/discord-gateway.js, relay/inbound.js).
    const relayInbound = relay.enabled ? createDiscordInbound({ db, perMinute: config.discordRelay.inboundPerMinute, maxChars: config.discordRelay.inboundMaxChars, ...(opts.inboundOptions || {}) }) : null;
    if (!opts.relay) {
        relay.attach({
            worker: createRelayEventsWorker({
                db, relay, enabled: config.discordRelay.events, eventsUrl: config.discordRelay.eventsUrl, clientSecret: config.oauth.clientSecret,
                tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId, pollMs: config.discordRelay.eventsPollMs, fetchImpl: opts.fetchImpl,
                ...(opts.relayWorkerOptions || {}),
            }),
            gateway: relayInbound && config.discordRelay.inbound ? createDiscordGateway({
                token: config.discordRelay.botToken, url: config.discordRelay.gatewayUrl,
                onDispatch: async (type, data, ctx) => await relayInbound.handle(type, data, ctx),
                ...(opts.gatewayOptions || {}),
            }) : null,
            inbound: relayInbound,
        });
    }
    // OpenVibe.VIP: members-only spaces and threads (fails closed without a client secret or VIP).
    const vip = opts.vip || createVipGate({ config, ...(opts.vipOptions || {}) });
    // Images on posts go to OpenVibe.Media's Object API as med_ objects (media/objects.js).
    const mediaObjects = opts.mediaObjects || require('./media/objects').createMediaObjects({ config });
    // A space's chat room on OpenVibe.Chat (chat-rooms.js): attached with the person's own token.
    const chatRooms = opts.chatRooms || require('./chat-rooms').createChatRooms({ config });
    // IndexNow (openvibe-shared/indexnow): created once at boot from INDEXNOW_KEY; unset → off
    // (nothing mounted, nothing sent). The key file is served at /<key>.txt and the forum service
    // pings the engines when a public, indexable page appears, changes or goes away.
    const indexnow = opts.indexnow || createIndexNow({ host: config.baseUrl, key: config.indexnow.key, ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}) });
    const forum = createForumService({ db, network, relay, vip, media: mediaObjects, chatRooms, limits: opts.forumLimits, config, indexnow });
    discovery.useForum(forum);
    Object.assign(app.locals, { db, network, relay, relayInbound, vip, forum, indexnow });
    if (opts.startRelay !== false) relay.start();

    // Per-actor limits for every API router below (server/actor-limits.js), after each one resolves its
    // viewer; the per-address /api/ limit stays in front. opts.actorLimits: { limits, now } (tests).
    // Valkey (ADR-035): the per-actor limit counters, shared across processes; opts.valkey for tests (null: none).
    const valkey = opts.valkey !== undefined ? opts.valkey
        : (config.valkey.url ? require('openvibe-sdk/valkey').createValkey({ url: config.valkey.url, prefix: config.valkey.prefix }) : null);
    app.locals.valkey = valkey;
    const limits = createActorLimits({ registry: metrics.registry, valkey, ...(opts.actorLimits || {}) });

    // ── /api/v1: the forum, its groups and the relay admin ───
    app.use('/api/', rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));
    app.use('/api/v1/spaces', createSpacesApi({ forum, viewers, limits }));
    app.use('/api/v1/posts', createPostsApi({ forum, viewers, limits }));
    app.use('/api/v1/space-groups', createGroupsApi({ forum, viewers, limits }));
    app.use('/api/v1/relay', createRelayApi({ relay, db, viewers, inbound: relayInbound, limits }));
    // OpenVibe.Events → Space (server/events-consumer.js): token cutoffs, platform blocks, account
    // export/deletion/merge and VIP cache convergence.
    const eventsConsumer = require('./events-consumer').createEventsConsumer({ db, vipCache: vip && vip.cache, revocations, accountSend: config.oauth && config.oauth.clientSecret ? require('./identity/account-data').createSender({ config }) : null, secrets: String(process.env.SPACE_EVENTS_SECRET || '').split(',').map((s) => s.trim()).filter(Boolean) });
    app.locals.eventsConsumer = eventsConsumer;
    // Never per-actor limited: Events pushes at its own pace (a 429 only makes it retry and fall behind),
    // and these deliveries carry token cutoffs and account deletions.
    app.use('/internal/events', eventsConsumer.router);

    app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'openvibe-space', version: VERSION }));
    // GET /release.json (ADR-016) and POST /release-metrics: open tabs' update reports (a same-origin
    // sendBeacon, no auth) into /metrics as release_client_updates_total.
    release.mount(app, { registry: metrics.registry });
    // Readiness reports what is actually served: 503 only without the database; the Network key
    // and Media failures degrade (server/observability.js).
    const readiness = require('./observability').createSpaceReadiness({ db, auth, config, relay, release: release.release, fetchImpl: opts.fetchImpl, valkey });
    app.get('/api/ready', readiness.handler);

    // ── Static assets (content-hashed ?v= → immutable) ───────
    // This site's own pinned copy of the OpenVibe Frame's browser files (openvibe-shared/serve).
    app.use('/shared', require('openvibe-shared/serve').handler());
    app.use(express.static(PUBLIC_DIR, {
        index: false, etag: true, redirect: false,
        setHeaders(res, filePath) {
            const rel = path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
            const v = res.req && res.req.query && res.req.query.v;
            res.setHeader('Cache-Control', cache.assetHeaders(rel, { hashed: !!v && v === assetVersion(rel) }));
        },
    }));

    // ── Machine endpoints ────────────────────────────────────
    // Written by openvibe-shared/seo from server/discovery.js; the sitemap is rebuilt at most hourly.
    app.get('/robots.txt', (_req, res) => res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 }))
        .send(seo.robotsTxt({ sitemaps: [`${config.baseUrl}/sitemap.xml`], disallow: discovery.ROBOTS_DISALLOW })));
    app.get('/llms.txt', (_req, res) => res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 }))
        .send(seo.llmsTxt({ name: SITE_NAME, summary: discovery.SUMMARY, details: discovery.CONTENT_LABELS, sections: discovery.llmsSections() })));
    app.get('/llms-full.txt', wrap(async (_req, res) => res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 }))
        .send(seo.llmsFull({ site: SITE_NAME, summary: discovery.SUMMARY, base: config.baseUrl, sections: await discovery.llmsFullSections(), maxBytes: 512 * 1024 }))));
    app.get('/sitemap.xml', async (_req, res) => {
        let rows;
        try { rows = await discovery.sitemapRows(); } catch { return res.status(503).end(); }
        res.type('application/xml').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 })).send(seo.sitemapXml(rows));
    });
    // GET /<key>.txt — the IndexNow key file (only when a key is configured; it serves itself).
    if (indexnow.enabled) app.use(indexnow.keyFile);

    // ── Pages ────────────────────────────────────────────────
    // Pages are for browsers: the viewer (subject, staff) is resolved here too.
    // Every page response below (redirects and error pages too) that sets no policy of its own.
    app.use(cache.applyHtml({ private: true }));

    // The board index lives at /s (GET /s renders it); / sends visitors there.
    app.get('/', (_req, res) => res.redirect(301, '/s'));
    // /updates: Space ships with the community's log until it has one of its own.
    app.get('/updates', (_req, res) => res.redirect(302, `${config.communityUrl}/updates`));

    app.use(createForumRoutes({ forum, viewers, config }));

    // ── 404 / errors ─────────────────────────────────────────
    app.use((req, res) => {
        if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
        const pages = require('./render/pages');
        res.status(404).type('html').set('Cache-Control', PAGE_CACHE).send(pages.errorPage({ status: 404, title: 'Page not found', message: 'Nothing lives at that address.' }));
    });
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        console.error('[App]', err && err.stack ? err.stack : err);
        if (res.headersSent) return;
        if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Internal error' });
        const pages = require('./render/pages');
        res.status(500).type('html').set('Cache-Control', PAGE_CACHE).send(pages.errorPage({ status: 500, title: 'Something went wrong', message: 'This one is on us. Please try again.' }));
    });

    return app;
}

/** Async route wrapper — rejections reach the error handler. */
function wrap(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

module.exports = { createApp };
