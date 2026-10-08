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

    // OpenVibe.Community — the hub. The forum is Community's again (owner decision, 2026-10-08) and
    // every forum URL here redirects to the same path and query on Community.
    communityUrl: (process.env.OV_COMMUNITY_URL || 'https://openvibe.community').replace(/\/$/, ''),
    // OpenVibe.Live — the legal pages the shared footer links (the Network hosts the profile page).
    liveUrl: (process.env.OV_LIVE_URL || 'https://openvibe.live').replace(/\/$/, ''),

    // PostgreSQL (ADR-035). Space holds no user content yet; the database is kept for the release
    // ledger and the shared schema migrations. Without DATABASE_URL, development uses an embedded
    // PGlite database in data/pglite.
    db: { url: process.env.DATABASE_URL || '', directUrl: process.env.DATABASE_DIRECT_URL || '' },
};
