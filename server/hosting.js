'use strict';

/** Static hosting engine mounted by Space's existing app. */
const rateLimit = require('express-rate-limit');
const contracts = require('openvibe-contracts');
const { createIndexNow } = require('openvibe-shared/indexnow');
const { load } = require('./hosting-config');
const { createBlobStore } = require('./storage');
const { createHostOutbox } = require('./events/outbox');
const { createAccess } = require('./domain/access');
const { createTakedowns } = require('./domain/takedowns');
const { createProjects } = require('./domain/projects');
const { createSites } = require('./domain/sites');
const { createDeploys } = require('./domain/deploys');
const { createDomains } = require('./domain/domains');
const { createSiteConfig } = require('./domain/site-config');
const { createSiteSources } = require('./domain/site-sources');
const { createViewerResolver, guard } = require('./auth/viewer');
const { createTenantServer } = require('./http/tenant');
const { createUploadGate } = require('./http/upload');
const { createApi } = require('./http/api');
const resourceIndex = require('./registry/resource-index');
const { createDashboard } = require('./http/dashboard');
const { createWorker } = require('./worker');
const { createSpaceBilling } = require('./billing');
const { createStore } = require('./db');

function createHosting(app, { db, auth, config: suppliedConfig, now, resolver, fetchImpl, indexnow: injectedIndexNow, log = console, storageDir, valkey, forumRedirect } = {}) {
    const config = suppliedConfig || load();
    const store = createStore(db, { now });
    const media = config.objectStore.mode === 'media' ? {
        url: config.media.url, namespace: config.media.namespace, scope: config.media.scope,
        clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
        tokenUrl: `${config.networkInternalUrl}/oauth/token`, ...(fetchImpl ? { fetchImpl } : {}),
    } : null;
    const referenced = db.prepare('SELECT 1 FROM space_blobs WHERE project_id = ? AND sha256 = ?');
    const blobs = createBlobStore(storageDir || config.storageDir, {
        media, isReferenced: async (projectId, sha256) => Boolean(await referenced.get(projectId, sha256)),
    });
    const indexnow = injectedIndexNow !== undefined ? injectedIndexNow : createIndexNow({ host: config.baseUrl, key: config.indexnow.key, ...(fetchImpl ? { fetch: fetchImpl } : {}), log });
    const indexnowHosts = new Map();
    function announce(hostname, paths) {
        if (!indexnow.enabled || !hostname) return;
        if (!indexnowHosts.has(hostname)) indexnowHosts.set(hostname, createIndexNow({ host: hostname, key: config.indexnow.key, ...(fetchImpl ? { fetch: fetchImpl } : {}), log }));
        const u = new URL(config.baseUrl);
        const origin = `${u.protocol}//${hostname}${u.port ? `:${u.port}` : ''}`;
        (injectedIndexNow !== undefined ? indexnow : indexnowHosts.get(hostname)).pingSoon(paths.map((p) => new URL(p, origin).href));
    }
    const outbox = createHostOutbox({ db, config, fetchImpl, now: store.now, log });
    const access = createAccess({ store });
    const takedowns = createTakedowns({ store });
    const projects = createProjects({ store, config, access, blobs, takedowns, log, indexnow: announce });
    const sites = createSites({ store, config, access, projects, takedowns, indexnow: announce });
    const deploys = createDeploys({ store, config, access, projects, sites, blobs, outbox, takedowns, log, indexnow: announce });
    const domains = createDomains({ store, config, access, projects, sites, outbox, resolver, log, indexnow: announce });
    const siteConfig = createSiteConfig({ store });
    const siteSources = createSiteSources({ store, sites });
    const viewers = createViewerResolver({ auth, config, log });
    const tenant = createTenantServer({ store, config, blobs, takedowns, siteConfig, access, log });
    const uploadGate = createUploadGate(config.uploads.maxConcurrent);
    const worker = createWorker({ config, store, domains, blobs, outbox, log });
    const billing = createSpaceBilling({ db, config, now: store.now, ...(fetchImpl ? { fetchImpl } : {}), log });
    const ctx = { config, store, blobs, outbox, billing, access, takedowns, projects, sites, deploys, domains, siteConfig, siteSources, auth, viewers, tenant, worker, uploadGate, indexnow, log, valkey: valkey || null };
    ctx.actorLimits = require('./http/actor-limits').createHostActorLimits({ registry: app.locals.metrics, valkey: ctx.valkey });
    app.locals.ctx = ctx;
    if (app.locals.metrics && typeof app.locals.metrics.gauge === 'function') {
        app.locals.metrics.gauge({
            name: 'space_sites', help: 'Active tenant sites',
            collect: async () => [{ labels: {}, value: (await db.prepare("SELECT COUNT(*) AS n FROM space_sites WHERE status = 'active'").get()).n }],
        });
    }
    require('./http/errors').setLogger(log);

    /**
     * Mounted first (server/app.js), before the platform's own headers, metrics route, auth, API and readiness:
     * a tenant host is answered here and never reaches anything below (Host's order, test/hosting-isolation and
     * test/hosting-site-config). The IndexNow key file answers on every host, a tenant's included.
     */
    ctx.mountDispatch = (target) => {
        if (indexnow.enabled) target.use(indexnow.keyFile);
        target.use(async (req, res, next) => {
            try {
                const target = await tenant.resolve(req.headers.host);
                req.hostTarget = target.kind;
                if (target.kind === 'dashboard') return next();
                if (target.kind === 'site') return await tenant.handle(req, res, target.site);
                return tenant.unknownHost(req, res);
            } catch (err) { return next(err); }
        });
    };

    /** The dashboard host's hosting routes: forum redirects, the hosting API, previews, the dashboard and the limits page. */
    ctx.mountRoutes = (app) => {
        if (forumRedirect) app.use(forumRedirect);
        app.use(contracts.http.middleware());
        app.use('/api/v1/resources', rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }), viewers.middleware('api'), resourceIndex.router({ guard: guard('space.resource.read') }));
        app.use('/api/v1', rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }), createApi(ctx));
        app.use('/preview', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }), viewers.middleware('dashboard'), (req, res, next) => Promise.resolve(tenant.preview(req, res)).catch(next));
        app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }), createDashboard(ctx));
        require('./limits').mountLimits(app, config);
    };
    return ctx;
}

module.exports = { createHosting };
