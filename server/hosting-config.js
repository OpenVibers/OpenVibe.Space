'use strict';

/**
 * OpenVibe.Space Stage B (tenant static hosting) configuration. Every value comes from the
 * environment (production: /etc/openvibe/space.env, see .env.example). Only environment variable
 * NAMES appear in code and docs; secret values are never logged or returned.
 *
 * load(env) is pure so tests can build a config without touching process.env.
 */
require('dotenv').config();

const trim = (s) => String(s || '').replace(/\/+$/, '');
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const MiB = 1024 * 1024;

function load(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const port = int(env.PORT, 4940);
    const baseUrl = trim(env.BASE_URL || (isProduction ? 'https://openvibe.space' : `http://localhost:${port}`));
    const dashboardHost = new URL(baseUrl).hostname.toLowerCase();
    // Tenant sites are served at <site>.<sitesDomain>. It must be a registrable domain of its own,
    // never a subdomain of openvibe.network / openvibe.live (their cookies must never reach tenants).
    const sitesDomain = String(env.SPACE_SITES_DOMAIN || 'openvibe.website').toLowerCase().replace(/^\.+|\.+$/g, '');

    const quota = (prefix, defaults) => ({
        storageBytes: int(env[`${prefix}STORAGE_BYTES`], defaults.storageBytes),
        deploysPerDay: int(env[`${prefix}DEPLOYS_PER_DAY`], defaults.deploysPerDay),
        maxFiles: int(env[`${prefix}MAX_FILES`], defaults.maxFiles),
        maxFileBytes: int(env[`${prefix}MAX_FILE_BYTES`], defaults.maxFileBytes),
        sites: int(env[`${prefix}SITES`], defaults.sites),
        customDomains: int(env[`${prefix}CUSTOM_DOMAINS`], defaults.customDomains),
    });

    return {
        service: 'space',
        port,
        host: env.HOST || '127.0.0.1',
        nodeEnv,
        isProduction,
        baseUrl,
        dashboardHost,
        sitesDomain,
        trustProxy: env.TRUST_PROXY != null ? Number(env.TRUST_PROXY) : 1,   // nginx (realip) → Node

        // PostgreSQL (ADR-035): DATABASE_URL serves (PgBouncer), DATABASE_DIRECT_URL migrates (owner role).
        // SPACE_PGLITE_DIR: where the development-only embedded database lives (default data/pglite); tests
        // point it at a temp directory so a spawned server gets a database of its own.
        db: { url: env.DATABASE_URL || '', directUrl: env.DATABASE_DIRECT_URL || '', pgliteDir: env.SPACE_PGLITE_DIR || '' },
        valkey: { url: env.VALKEY_URL || '', prefix: env.VALKEY_PREFIX || 'ov:space:' },
        // Content-addressed deploy objects, one directory per project (tenancy keyed by project id).
        storageDir: env.SPACE_STORAGE_DIR || './data/objects',

        // Tenant objects: local disk is the store and the read cache. SPACE_OBJECT_STORE=media writes
        // every object through to OpenVibe.Media as well (Space's own namespace `space`, keyed per
        // project, sha256 as content_hash) and serves a local miss from there; unset keeps the local
        // store exactly as it is. OV_MEDIA_URL is the internal Media base URL; the credential is
        // Space's Network service principal (OV_OAUTH_CLIENT_ID/SECRET), audience openvibe.media.
        objectStore: {
            mode: String(env.SPACE_OBJECT_STORE || '').toLowerCase() === 'media' ? 'media' : 'local',
        },
        media: {
            url: trim(env.OV_MEDIA_URL || 'http://127.0.0.1:4100'),
            namespace: String(env.OV_MEDIA_NAMESPACE || 'space').trim() || 'space',
            scope: 'media.object.upload media.object.read media.object.list media.object.delete',
        },

        // OpenVibe.Network: SSO (OAuth2 authorization server), JWKS, client-credentials tokens.
        networkUrl: trim(env.OV_NETWORK_URL || 'https://openvibe.network'),
        networkInternalUrl: trim(env.OV_NETWORK_INTERNAL_URL || 'http://127.0.0.1:4000'),
        oauth: {
            clientId: env.OV_OAUTH_CLIENT_ID || 'space',
            clientSecret: env.OV_OAUTH_CLIENT_SECRET || '',
            redirectUri: env.OV_OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`,
            scope: 'profile theme',
        },
        cookies: { secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction },
        // Signs the dashboard form tokens (CSRF). Unset: a random per-process key.
        formSecret: env.SPACE_FORM_SECRET || '',

        // IndexNow (openvibe-shared/indexnow): a key makes search engines recrawl a tenant site the
        // moment its active deploy appears, changes or goes away (the key file is served at
        // /<key>.txt on every host). Unset → off: no key file, nothing sent. Tests and drills never
        // set it (the drill sets INDEXNOW_KEY empty in space.example.json).
        indexnow: { key: String(env.INDEXNOW_KEY || '').trim() },

        // OpenVibe.Events: the outbox relay runs only when EVENTS_URL and the client secret are set.
        events: {
            url: trim(env.EVENTS_URL || ''),
            intervalMs: int(env.EVENTS_RELAY_INTERVAL_MS, 2000),
        },
        // OpenVibe.Billing (plan T5 step 14): daily gb-month storage readings for the bytes the local object store
        // keeps (server/billing.js). SPACE_BILLING_INTERVAL_MS=0 (the default) starts nothing; Media mode emits no
        // reading (Media bills the bytes). Relayed with Space's service token (OV_OAUTH_CLIENT_ID/SECRET).
        billing: {
            intervalMs: Math.max(0, int(env.SPACE_BILLING_INTERVAL_MS, 0)),
            url: trim(env.OV_BILLING_URL || env.OV_BILLING_INTERNAL_URL || ''),
            audience: env.OV_BILLING_AUDIENCE || 'openvibe.billing',
            timeoutMs: int(env.SPACE_BILLING_TIMEOUT_MS, 10000),
        },
        community: {
            internalUrl: trim(env.SPACE_COMMUNITY_URL || ''),
            publicUrl: trim(env.OV_COMMUNITY_URL || 'https://openvibe.community'),
        },

        uploads: {
            // Largest request body accepted for one deploy (the compressed archive or all multipart parts).
            maxUploadBytes: int(env.SPACE_MAX_UPLOAD_BYTES, 100 * MiB),
            // Largest size an archive may unpack to (also capped by the project's storage quota). The
            // unpacked files are held in memory while they are checked, so this bounds what a small
            // gzip bomb can cost, whatever quota staff grant a project.
            maxUnpackedBytes: int(env.SPACE_MAX_UNPACKED_BYTES, 256 * MiB),
            // Uploads read and validated at the same time, service-wide (each is held in memory).
            maxConcurrent: int(env.SPACE_MAX_CONCURRENT_UPLOADS, 2),
            // Uploads are refused while the object store's filesystem has less than this free. The
            // disk is shared with every other service on the host (Live, Media, databases), so a
            // tenant must never be able to fill it.
            minFreeBytes: int(env.SPACE_MIN_FREE_BYTES, 5 * 1024 * MiB),
        },
        // Projects one person may own (each gets the per-project quotas below).
        projects: {
            maxPerOwner: int(env.SPACE_MAX_PROJECTS_PER_OWNER, 10),
        },
        // Public hosting is owner-gated (plan T20/O34: the owner's go-ahead, a DMCA designated agent and a Public
        // Suffix List entry come first). Until SPACE_PUBLIC_HOSTING=on only OpenVibe staff can create projects, and the
        // front page says hosting is not open yet; everything else about the engine is unchanged.
        publicHosting: String(env.SPACE_PUBLIC_HOSTING || 'off').trim().toLowerCase() === 'on',

        // Per-project quotas (a row in space_quotas overrides them per project; only staff set it).
        quotas: {
            production: quota('SPACE_QUOTA_', { storageBytes: 1024 * MiB, deploysPerDay: 50, maxFiles: 10000, maxFileBytes: 25 * MiB, sites: 10, customDomains: 5 }),
            sandbox: quota('SPACE_SANDBOX_QUOTA_', { storageBytes: 100 * MiB, deploysPerDay: 20, maxFiles: 2000, maxFileBytes: 10 * MiB, sites: 3, customDomains: 0 }),
        },

        domains: {
            // What a custom domain's CNAME points at. Default: the site's own <site>.<sitesDomain>.
            cnameTarget: String(env.SPACE_CNAME_TARGET || '').toLowerCase() || null,
            originIpv4: env.SPACE_ORIGIN_IPV4 || null,
            originIpv6: env.SPACE_ORIGIN_IPV6 || null,
            dnsServers: list(env.SPACE_DNS_SERVERS),
            recheckIntervalMs: int(env.SPACE_DOMAIN_RECHECK_MS, 10 * 60 * 1000),
            pendingDays: int(env.SPACE_DOMAIN_PENDING_DAYS, 7),
            lapseDays: int(env.SPACE_DOMAIN_LAPSE_DAYS, 7),
            extraReserved: list(env.SPACE_RESERVED_DOMAINS).map((d) => d.toLowerCase()),
        },

        sites: { extraReservedNames: list(env.SPACE_RESERVED_SITE_NAMES).map((d) => d.toLowerCase()) },

        worker: {
            enabled: env.SPACE_WORKER !== 'off',
            id: env.SPACE_WORKER_ID || `space-${process.pid}`,
        },

        // Browser origins that may call /api/v1 with a Bearer Network JWT (never cookies).
        apiCorsOrigins: list(env.API_CORS_ORIGINS || 'https://openvibe.network,https://openvibe.codes'),
    };
}

module.exports = { load };
