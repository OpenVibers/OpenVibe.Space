'use strict';
/**
 * The API a published space's page calls (the space SDK, server/spaces/sdk.js), on the dashboard host:
 *
 *   POST   /api/v1/apps/:id/token       { code, code_verifier } → { token, expires_in, user, capabilities }
 *   DELETE /api/v1/apps/:id/token       signs the visitor out of the space (the Bearer token is dropped)
 *   POST   /api/v1/apps/:id/run         { op, args } → { result }: me, items.list|add|set|remove, kv.get|set|remove, ai.ask
 *   GET    /api/v1/apps/:id/items/:collection?limit=&before=   the shared list, for anyone (no token needed)
 *
 * Only the space's own origin (https://<slug>.openvibe.website) may call it from a browser: CORS answers that one
 * origin and never credentials; a request that names another Origin is refused. The token is a Bearer header the
 * space's page holds; cookies are never read here. A space must be published (and not taken down) to be called.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ApiError } = require('../http/errors');

function createSpacesApi({ config, spaces, data, sites, takedowns, log = console }) {
    const router = express.Router();
    const json = express.json({ limit: '64kb' });
    router.use(rateLimit({ windowMs: 60_000, max: config.spaces.apiPerMinute, standardHeaders: true, legacyHeaders: false }));

    const send = (res, status, body) => res.status(status).set('Cache-Control', 'no-store').json(body);
    const sendError = (res, err) => {
        if (err instanceof ApiError || (err && Number.isInteger(err.status) && err.code)) return send(res, err.status, { error: { code: err.code, message: err.message } });
        log.error('[Spaces API]', err && err.stack ? err.stack : err);
        return send(res, 500, { error: { code: 'internal', message: 'Something went wrong on our side' } });
    };

    /** The published space at :id, its origin checked; CORS for that origin only. */
    async function spaceOf(req, res) {
        const space = await spaces.get(req.params.id);
        const notFound = new ApiError(404, 'space.not_found', 'no such space');
        if (!space || !space.site_id) throw notFound;
        const site = await sites.get(space.site_id);
        if (!site || site.status !== 'active') throw notFound;
        if (takedowns && await takedowns.ofSite(site)) throw new ApiError(451, 'space.taken_down', 'this space is unavailable');
        const own = spaces.urlOf(space);
        const origin = req.get('origin');
        if (origin) {
            if (origin !== own) throw new ApiError(403, 'space.origin', 'only the space\'s own page may call this');
            res.set('Access-Control-Allow-Origin', own);
            res.vary('Origin');
        }
        return space;
    }
    const bearer = (req) => {
        const h = req.get('authorization') || '';
        const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(h);
        return m ? m[1] : null;
    };
    const handle = (fn) => async (req, res) => {
        try {
            const space = await spaceOf(req, res);
            const out = await fn(req, res, space);
            if (!res.headersSent) send(res, 200, out);
        } catch (err) { sendError(res, err); }
    };

    // Preflight: answered for the space's own origin only.
    router.options('/:id/*', async (req, res) => {
        try {
            await spaceOf(req, res);
            res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE');
            res.set('Access-Control-Max-Age', '600');
            res.status(204).end();
        } catch (err) { res.status(err.status || 404).end(); }
    });

    router.post('/:id/token', json, handle(async (req, res, space) => {
        if (!req.get('origin')) throw new ApiError(403, 'space.origin', 'the sign-in code is traded from the space\'s own page');
        const b = req.body || {};
        return await data.exchange(space, { code: b.code, verifier: b.code_verifier });
    }));
    router.delete('/:id/token', handle(async (req) => { await data.revoke(bearer(req)); return { signed_out: true }; }));

    router.post('/:id/run', json, handle(async (req, res, space) => {
        const b = req.body || {};
        const token = bearer(req);
        const who = token ? await data.verify(space, token) : null;
        if (token && !who && b.op !== 'items.list') throw new ApiError(401, 'auth.required', 'the sign-in for this space expired; sign in again');
        const ctx = { space, person: who ? who.person : null, capabilities: who ? who.capabilities : [], owner: Boolean(who && who.person.subject === space.owner_subject) };
        return { result: await data.run(String(b.op || ''), b.args || {}, ctx) };
    }));

    router.get('/:id/items/:collection', handle(async (req, res, space) => {
        const items = await data.listItems(space, req.params.collection, { limit: req.query.limit, before: req.query.before });
        return { items: items.map((i) => ({ ...i, mine: false })) };
    }));

    return router;
}

module.exports = { createSpacesApi };
