'use strict';

/**
 * OpenVibe.Space — code and dynamic pages for the OpenVibe network.
 *
 * Express app factory (server/index.js listens; tests build their own instance).
 *
 * Space is being rebuilt and publishes one page of its own:
 *
 *   GET /                        the home page: what Space will host, and where the forum went
 *   GET /auth/login|callback|fedcm|logout|me|refresh   sign-in (OpenVibe.Network OAuth2 client)
 *   GET /robots.txt, /llms.txt, /llms-full.txt, /sitemap.xml   crawler endpoints (the sitemap is / alone)
 *   GET /api/health, /api/ready, /release.json, /metrics (loopback)
 *
 * The forum is OpenVibe.Community's again (owner decision, 2026-10-08): every forum URL here answers
 * a permanent redirect to the same path and query there — /s and /s/* (301 for GET and HEAD, 308
 * otherwise), and /api/v1/spaces*, /api/v1/posts/*, /api/v1/space-groups* and /api/v1/relay* (308).
 *
 * Space holds no user content, so it consumes no network events and has no account export or
 * deletion: the forum's account data is Community's. See README.md.
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
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
// Pages are rendered for the person reading them (and the shared navbar reads their session), so no
// shared or browser cache keeps one.
const PAGE_CACHE = cache.htmlHeaders({ private: true });

/** The forum paths that now live on OpenVibe.Community: /s and /s/*, and the forum APIs. */
const FORUM_PAGE = /^\/s(\/|$)/;
const FORUM_API = /^\/api\/v1\/(spaces|posts|space-groups|relay)(\/|$)/;

/**
 * Permanent redirect to the same path and query on Community. A GET or HEAD of a page keeps its
 * method with a 301; anything else (a form post, a vote) must not be replayed as a GET, and the
 * APIs are called with bodies, so they always answer 308.
 */
function forumRedirect(req, res, next) {
    const isPage = FORUM_PAGE.test(req.path);
    if (!isPage && !FORUM_API.test(req.path)) return next();
    const method = String(req.method || 'GET').toUpperCase();
    const status = isPage && (method === 'GET' || method === 'HEAD') ? 301 : 308;
    res.redirect(status, `${config.communityUrl}${req.originalUrl}`);
}

async function createApp(opts = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    // What this server runs (ADR-016); the shared navbar's release-watch polls it.
    const release = require('openvibe-shared/release').createRelease({ service: 'space', root: path.join(__dirname, '..') });
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
                imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
                // The shared navbar's notification bell hears OpenVibe.Events (notificationsRealtime).
                connectSrc: ["'self'", 'https://openvibe.network', 'https://openvibe.events', 'https://cloudflareinsights.com'],
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

    // ── The forum is Community's: every forum URL redirects there ───
    app.use(forumRedirect);

    // ── Auth (OAuth2 client of OpenVibe.Network) ─────────────
    const auth = opts.auth || createAuthClient(config);
    app.locals.auth = auth;
    app.locals.config = config;
    app.use('/auth/', rateLimit({ windowMs: 15 * 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));
    app.use('/auth', createAuthRoutes(config, auth));
    { const legal = require('openvibe-shared/legal'); app.get(legal.PATHS, legal.handler({ id: 'space', service: 'space', host: 'openvibe.space', name: 'OpenVibe.Space', profile: 'ugc' })); app.get('/tos', (_req, res) => res.redirect(301, '/terms')); }

    // ── Space's database (for readiness and the shared schema) ───
    const db = opts.db || getDb();
    app.locals.db = db;

    // /updates: Space ships with the community's log until it has one of its own.
    app.get('/updates', (_req, res) => res.redirect(302, `${config.communityUrl}/updates`));

    app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'openvibe-space', version: VERSION }));
    // GET /release.json (ADR-016) and POST /release-metrics: open tabs' update reports (a same-origin
    // sendBeacon, no auth) into /metrics as release_client_updates_total.
    release.mount(app, { registry: metrics.registry });
    // Readiness reports what is actually served: 503 only without the database; a Network key that has
    // not loaded degrades (server/observability.js).
    const readiness = require('./observability').createSpaceReadiness({ db, auth, config, release: release.release });
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
    // Written by openvibe-shared/seo from server/discovery.js; the sitemap is / alone.
    app.get('/robots.txt', (_req, res) => res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 }))
        .send(seo.robotsTxt({ sitemaps: [`${config.baseUrl}/sitemap.xml`], disallow: discovery.ROBOTS_DISALLOW })));
    app.get('/llms.txt', (_req, res) => res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 }))
        .send(seo.llmsTxt({ name: SITE_NAME, summary: discovery.SUMMARY, details: discovery.SUMMARY, sections: discovery.llmsSections() })));
    app.get('/llms-full.txt', wrap(async (_req, res) => res.type('text/plain').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 }))
        .send(seo.llmsFull({ site: SITE_NAME, summary: discovery.SUMMARY, base: config.baseUrl, sections: await discovery.llmsFullSections(), maxBytes: 512 * 1024 }))));
    app.get('/sitemap.xml', async (_req, res) => {
        let rows;
        try { rows = await discovery.sitemapRows(); } catch { return res.status(503).end(); }
        res.type('application/xml').set('Cache-Control', cache.htmlHeaders({ maxAge: 3600 })).send(seo.sitemapXml(rows));
    });

    // ── Pages ────────────────────────────────────────────────
    // The home page: what Space will host, and where the forum went (no fake features).
    app.get('/', (_req, res) => res.type('html').set('Cache-Control', PAGE_CACHE).send(require('./render/pages').homePage()));

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
