'use strict';
/** Boots the Network mock, points the app at it, and returns a tiny HTTP client that keeps cookies. */
const http = require('http');
const mockNetwork = require('./mock-network');

/**
 * Boots the Network mock (JWKS + the token endpoints sign-in needs), points the app at it, and
 * returns a tiny HTTP client. Every boot gets a migrated database of its own (./db.js: PGlite, or
 * the PostgreSQL containers under npm run test:pg).
 * opts.appOpts      passed through to createApp.
 * opts.env          environment set after the defaults, before the app loads (its OV_OAUTH_CLIENT_SECRET
 *                   is also the one the Network mock accepts).
 */
async function boot(opts = {}) {
    const netSrv = await mockNetwork.start({ clientSecret: (opts.env && opts.env.OV_OAUTH_CLIENT_SECRET) || 'shh' });
    process.env.NODE_ENV = 'test';
    process.env.BASE_URL = 'https://openvibe.space';
    process.env.OV_NETWORK_URL = netSrv.url;
    process.env.OV_NETWORK_INTERNAL_URL = netSrv.url;
    process.env.OV_OAUTH_CLIENT_ID = 'space';
    process.env.OV_OAUTH_CLIENT_SECRET = 'shh';
    process.env.OV_OAUTH_REDIRECT_URI = 'https://openvibe.space/auth/callback';
    process.env.COOKIE_SECURE = 'true';
    process.env.TRUST_PROXY = '1';
    Object.assign(process.env, opts.env || {});
    for (const k of Object.keys(require.cache)) if (k.includes('/server/')) delete require.cache[k];
    const { createApp } = require('../../server/app');
    const appOpts = { ...(opts.appOpts || {}) };
    appOpts.db = appOpts.db || await require('./db').testDb();
    const app = await createApp(appOpts);
    const server = await new Promise((resolve) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;

    const jar = new Map();
    async function get(path, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        const cookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).concat(opts.cookies || []);
        if (cookies.length) headers.cookie = cookies.join('; ');
        const res = await fetch(base + path, { method: opts.method || 'GET', headers, body: opts.body, redirect: 'manual', duplex: opts.body && typeof opts.body.pipe === 'function' ? 'half' : undefined });
        for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
            const [pair, ...attrs] = sc.split(';');
            const [k, v] = pair.split('=');
            const expired = attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim()));
            if (expired) jar.delete(k.trim()); else jar.set(k.trim(), v);
        }
        const text = await res.text();
        return { status: res.status, headers: res.headers, text, setCookies: res.headers.getSetCookie ? res.headers.getSetCookie() : [], json() { return JSON.parse(text); } };
    }
    return {
        app, base, get, jar, network: netSrv, db: appOpts.db || null,
        close: async () => {
            await new Promise((r) => server.close(r)); await netSrv.close();
            await appOpts.db.close().catch(() => {});
        },
    };
}

let failures = 0;
async function check(name, fn) {
    try { await fn(); console.log('  ✓', name); }
    catch (e) { failures++; console.log("  ✗", name, "\n     ", (e.stack || String(e)).split("\n").slice(0, process.env.DEBUG ? 40 : 4).join("\n      ")); }
}
function done() { console.log(failures ? `\n${failures} failed` : '\nall passed'); process.exit(failures ? 1 : 0); }

module.exports = { boot, check, done };
