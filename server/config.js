'use strict';

require('dotenv').config();

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

const port = parseInt(process.env.PORT, 10) || 4940;

module.exports = {
    port,
    host: process.env.HOST || '127.0.0.1',
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction,

    // Public URL of this site — canonical links, OG tags, sitemap entries.
    baseUrl: (process.env.BASE_URL || (isProduction ? 'https://openvibe.space' : `http://localhost:${port}`)).replace(/\/$/, ''),

    // Hops in front of Node that set X-Forwarded-For: Cloudflare → nginx → Node.
    trustProxy: process.env.TRUST_PROXY != null ? Number(process.env.TRUST_PROXY) : 2,

    // Per-actor limits at the API routes (server/actor-limits.js): the reads one caller may make to
    // one API per minute and per hour. Writes set their own numbers per route.
    limits: {
        minute: parseInt(process.env.SPACE_LIMITS_MINUTE, 10) || 120,
        hour: parseInt(process.env.SPACE_LIMITS_HOUR, 10) || 3000,
    },

    // Identity provider — OpenVibe.Network (OAuth2 authorization server + JWKS)
    networkUrl: (process.env.OV_NETWORK_URL || 'https://openvibe.network').replace(/\/$/, ''),
    networkInternalUrl: (process.env.OV_NETWORK_INTERNAL_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),

    // OAuth2 client credentials (client `space` registered in the Network's oauth_clients table)
    oauth: {
        clientId: process.env.OV_OAUTH_CLIENT_ID || 'space',
        clientSecret: process.env.OV_OAUTH_CLIENT_SECRET || '',
        redirectUri: process.env.OV_OAUTH_REDIRECT_URI
            || (isProduction ? 'https://openvibe.space/auth/callback' : 'http://localhost:4940/auth/callback'),
        scope: 'profile theme',
    },

    // Cookies are host-only for openvibe.space (no Domain attribute — there are no subdomains).
    cookies: {
        secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction,
    },

    // OpenVibe.Community — the hub (D12). Space's pages link the network Pulse feed it serves; Space
    // stores none of it (space.pulse.read is planned, not built).
    communityUrl: (process.env.OV_COMMUNITY_URL || 'https://openvibe.community').replace(/\/$/, ''),
    // OpenVibe.Live — author profile links (the Network hosts the profile page; Live's layout is the
    // familiar one) and avatars.
    liveUrl: (process.env.OV_LIVE_URL || 'https://openvibe.live').replace(/\/$/, ''),
    // OpenVibe.Media — public host that serves the images posts attach (med_ objects).
    mediaUrl: (process.env.OV_MEDIA_URL || 'https://openvibe.media').replace(/\/$/, ''),
    // Media's internal address: attachment uploads go to its Object API with a service token
    // (media.object.upload for audience openvibe.media).
    mediaInternalUrl: (process.env.OV_MEDIA_INTERNAL_URL || 'http://127.0.0.1:4100').replace(/\/$/, ''),

    // PostgreSQL (ADR-035) for Space's own data: the forum (spaces, threads, posts, votes,
    // categories, attachments), the Discord relay's bookkeeping and the account-data records.
    // DATABASE_URL serves (PgBouncer); DATABASE_DIRECT_URL migrates (owner). Without them,
    // development uses an embedded PGlite database in data/pglite.
    db: { url: process.env.DATABASE_URL || '', directUrl: process.env.DATABASE_DIRECT_URL || '' },
    // Valkey (ADR-035): per-actor limit counters shared across processes; without it they count in this process.
    valkey: { url: process.env.VALKEY_URL || '', prefix: process.env.VALKEY_PREFIX || 'ov:space:' },

    // Browser origins allowed to call the embeddable forum APIs with a Bearer Network JWT.
    // No cookies cross origins.
    apiCorsOrigins: (process.env.API_CORS_ORIGINS || 'https://openvibe.community,https://openvibe.live,https://openvibe.network,https://openvibe.tools')
        .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),

    // OpenVibe.VIP — members-only spaces and threads (forum/service.js). Every answer comes from
    // VIP's POST /api/v1/policies/evaluate (capability vip.resource.policy.evaluate, client
    // credentials of client `space`), cached per viewer: a "yes" at most ttlMs (the convergence
    // bound after VIP stops granting), a "no" denyTtlMs, a failure unavailableTtlMs. Without a
    // client secret or with VIP down, nobody but the owner and moderators gets in.
    vip: {
        internalUrl: (process.env.OV_VIP_INTERNAL_URL || 'http://127.0.0.1:4620').replace(/\/$/, ''),
        publicUrl: (process.env.OV_VIP_URL || 'https://openvibe.vip').replace(/\/$/, ''),
        timeoutMs: parseInt(process.env.VIP_TIMEOUT_MS, 10) || 2000,
        ttlMs: parseInt(process.env.VIP_CACHE_TTL_MS, 10) || 30_000,
        denyTtlMs: parseInt(process.env.VIP_CACHE_DENY_TTL_MS, 10) || 10_000,
        unavailableTtlMs: parseInt(process.env.VIP_CACHE_UNAVAILABLE_TTL_MS, 10) || 2_000,
    },

    // IndexNow (openvibe-shared/indexnow): when INDEXNOW_KEY is set, the key file is served at
    // /<key>.txt and a public, indexable page appearing, changing or going away pings the engines.
    // Unset: off — nothing is mounted and nothing is sent.
    indexnow: { key: process.env.INDEXNOW_KEY || '' },

    // OpenVibe.Chat — a space can attach a chat room (server/chat-rooms.js). Space asks Chat, with the
    // signed-in person's own Network token, whether they manage the room; the space page links it.
    chat: {
        url: (process.env.OV_CHAT_URL || 'https://openvibe.chat').replace(/\/$/, ''),
        internalUrl: (process.env.OV_CHAT_INTERNAL_URL || 'http://127.0.0.1:4400').replace(/\/$/, ''),
        timeoutMs: parseInt(process.env.CHAT_TIMEOUT_MS, 10) || 4000,
    },

    // Discord relay (server/relay; docs/discord-relay.md). Off by default, and inert without an owner's
    // webhook variables, mappings and (for inbound) bot token.
    //   out  threads and replies in mapped public spaces → the mapping's Discord webhook; edits and deletes follow
    //   in   replies on Discord → posts (the gateway; DISCORD_RELAY_INBOUND=on and DISCORD_BOT_TOKEN)
    // Webhook URLs live in environment variables named by relay_mappings.webhook_url_ref.
    discordRelay: {
        enabled: /^(1|true|yes|on)$/i.test(process.env.DISCORD_RELAY_ENABLED || ''),
        pollMs: parseInt(process.env.DISCORD_RELAY_POLL_MS, 10) || 30_000,
        backoffMs: parseInt(process.env.DISCORD_RELAY_BACKOFF_MS, 10) || 30_000,
        maxAttempts: parseInt(process.env.DISCORD_RELAY_MAX_ATTEMPTS, 10) || 6,
        // The only variables a mapping may name (comma-separated exact names); unset = DISCORD_WEBHOOK_*.
        webhookVars: (process.env.DISCORD_RELAY_WEBHOOK_VARS || '').split(',').map((s) => s.trim()).filter(Boolean),
        // The Events worker queues creates from space.thread.* / space.post.* (needs EVENTS_URL and
        // OV_OAUTH_CLIENT_SECRET, capability events.event.read); 'off' leaves them to the forum.
        events: !/^(0|false|no|off)$/i.test(process.env.DISCORD_RELAY_EVENTS || ''),
        eventsUrl: (process.env.EVENTS_URL || '').replace(/\/+$/, '') || null,
        eventsPollMs: parseInt(process.env.DISCORD_RELAY_EVENTS_POLL_MS, 10) || 5000,
        // Inbound through the Discord gateway (a bot in the server with the MESSAGE CONTENT intent).
        inbound: /^(1|true|yes|on)$/i.test(process.env.DISCORD_RELAY_INBOUND || ''),
        botToken: process.env.DISCORD_BOT_TOKEN || '',
        gatewayUrl: process.env.DISCORD_GATEWAY_URL || 'wss://gateway.discord.gg/?v=10&encoding=json',
        inboundPerMinute: parseInt(process.env.DISCORD_RELAY_INBOUND_PER_MINUTE, 10) || 6,
        inboundMaxChars: parseInt(process.env.DISCORD_RELAY_INBOUND_MAX_CHARS, 10) || 4000,
    },
};
