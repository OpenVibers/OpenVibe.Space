'use strict';
/**
 * Spaces on the dashboard host (openvibe.space), with the visitor's Space session:
 *
 *   GET  /spaces                      the gallery (published public spaces) and the templates
 *   GET  /spaces/new · POST           make one: from a template, or described to the AI builder
 *   GET  /spaces/mine                 your spaces
 *   GET  /spaces/:slug                a space's page (a draft only for its maker)
 *   GET  /spaces/:slug/edit           the editor (maker or staff)
 *   POST /spaces/:slug/fork           a copy of a space you can open, as your own draft
 *   GET  /spaces/:slug/connect · POST the sign-in a visitor approves for a published space; back to the space with a code
 *   GET  /_openvibe/sdk.js            the SDK in preview mode (the editor's sandboxed frame loads it from here)
 *
 * The editor's JSON calls (same origin, the form token in X-CSRF-Token):
 *   PUT /spaces/:slug/files · PUT /spaces/:slug/settings · POST /spaces/:slug/ai · GET /spaces/:slug/ai
 *   POST /spaces/:slug/publish · POST /spaces/:slug/unpublish · POST /spaces/:slug/delete
 *   POST /spaces/:slug/preview        { op, args }: an SDK call from the preview, run as the maker
 */
const express = require('express');
const { ApiError } = require('../http/errors');
const { csrfToken, checkCsrf, sameOrigin } = require('../auth/forms');
const templates = require('./templates');
const render = require('./render');
const { sdkSource } = require('./sdk');

const BUILD_STALE = 10 * 60 * 1000;
const STATE_RE = /^[A-Za-z0-9_-]{8,100}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** A path on the space's own host to come back to: absolute-path only, no scheme, host, backslash or control character. */
function cleanReturn(v) {
    const s = String(v || '/').split('#')[0];
    if (s.length > 500 || !s.startsWith('/') || s.startsWith('//') || /[\\\u0000-\u001f\u007f\s]/.test(s)) return '/';
    return s;
}

function createSpacesPages(ctx) {
    const { config, viewers, spaces, spaceData: data, spacesAi: ai, log = console } = ctx;
    const router = express.Router();
    const urlencoded = express.urlencoded({ extended: false, limit: '16kb' });
    const json = express.json({ limit: Math.ceil(config.spaces.maxBytes * 1.5) + 65536 });
    const limits = config.spaces;

    router.use(viewers.middleware('dashboard'));
    if (ctx.actorLimits) router.use(ctx.actorLimits);
    router.use((req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        // The editor's preview frame (srcdoc) inherits this policy, so a space's pinned CDN scripts and fonts run in
        // it as they will on the space's own address; a space's page embeds the published space.
        const sites = `https://*.${config.sitesDomain}`;
        res.set('Content-Security-Policy', [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://openvibe.network https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://static.cloudflareinsights.com",
            "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://openvibe.network",
            "font-src 'self' data: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.gstatic.com",
            "img-src 'self' data: blob: https:", "media-src 'self' data: blob: https:",
            "connect-src 'self' https://openvibe.network https://openvibe.events https://cloudflareinsights.com",
            `frame-src 'self' https://openvibe.network ${sites}`, "frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'",
            "form-action 'self' https://openvibe.network", "script-src-attr 'unsafe-inline'",
        ].join('; '));
        next();
    });

    const signedIn = (req) => req.viewer && req.viewer.kind === 'user';
    const csrfOf = (req) => (signedIn(req) ? csrfToken(config, req.viewer) : '');
    const html = (res, status, body) => res.status(status).type('html').send(body);
    function failPage(req, res, err) {
        // A gated page answers on this origin with noindex, so a crawler is never handed Network sign-in's
        // canonical (audit SEO-7). A form still redirects: its session ended, and sign-in brings the person back.
        if (err && err.status === 401) {
            if (req.method !== 'GET') return res.redirect(303, `/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
            // The link goes back to the path only: a query string on a gated page must never come back in an
            // anonymous response (the same rule Chat's security suite enforces; SEO-7 review 2026-10-29).
            return html(res, 401, render.signInPage({ path: req.path, next: req.path }));
        }
        if (!(err instanceof ApiError) && !(err && Number.isInteger(err.status) && err.code)) log.error('[Spaces]', err && err.stack ? err.stack : err);
        const status = err && Number.isInteger(err.status) ? err.status : 500;
        return html(res, status, render.errorBody(status, status === 500 ? 'Something went wrong on our side. Try again in a moment.' : err.message));
    }
    const view = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { failPage(req, res, err); } };
    /** A form POST: signed in, from this site, with the form token. */
    const action = (fn) => [urlencoded, view(async (req, res) => {
        if (!signedIn(req)) throw new ApiError(401, 'auth.required', 'sign in first');
        if (!sameOrigin(config, req) || !checkCsrf(config, req.viewer, req.body && req.body.csrf)) throw new ApiError(403, 'form.invalid', 'this form expired or did not come from this site; reload the page and try again');
        await fn(req, res);
    })];
    /** An editor JSON call: signed in, same origin, the form token in X-CSRF-Token. */
    const api = (fn) => [json, async (req, res) => {
        try {
            if (!signedIn(req)) throw new ApiError(401, 'auth.required', 'sign in again');
            if (!sameOrigin(config, req) || !checkCsrf(config, req.viewer, req.get('x-csrf-token'))) throw new ApiError(403, 'form.invalid', 'this page expired; reload it');
            res.json(await fn(req, res));
        } catch (err) {
            if (!(err instanceof ApiError) && !(err && Number.isInteger(err.status) && err.code)) log.error('[Spaces editor]', err && err.stack ? err.stack : err);
            const status = err && Number.isInteger(err.status) ? err.status : 500;
            res.status(status).json({ error: { code: (err && err.code) || 'internal', message: status === 500 ? 'Something went wrong on our side' : err.message } });
        }
    }];
    const buildsLeft = async (req) => (signedIn(req) ? Math.max(0, limits.aiBuildsPerDay - await spaces.used(`build:${req.viewer.subject}`)) : 0);
    const settingsOut = (s) => ({ id: s.id, slug: s.slug, name: s.name, description: s.description, instructions: s.instructions, capabilities: spaces.capsOf(s.capabilities), visibility: s.visibility, published: Boolean(s.site_id), url: spaces.urlOf(s), building: Boolean(s.building_run_id) });

    router.get('/_openvibe/sdk.js', (req, res) => {
        res.set('Cache-Control', 'no-cache').type('application/javascript').send(sdkSource({ mode: 'preview', avatar: `${config.networkUrl}/avatar/{username}` }));
    });

    router.get('/spaces', view(async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q : '';
        const sort = req.query.sort === 'popular' ? 'popular' : 'new';
        html(res, 200, render.galleryPage({ viewer: signedIn(req) ? req.viewer : null, spaces: await spaces.gallery({ q, sort }), templates: templates.list(), q, sort, csrf: csrfOf(req) }));
    }));

    router.get('/spaces/new', view(async (req, res) => {
        if (!signedIn(req)) throw new ApiError(401, 'auth.required', 'sign in first');
        // ?template=<id>: someone picked a template on openvibe.website; it leads the page, one press from a new space.
        const pick = req.query.template ? templates.get(String(req.query.template)) : null;
        html(res, 200, render.newPage({ viewer: req.viewer, templates: templates.list(), csrf: csrfOf(req), aiOn: ai.enabled(), buildsLeft: await buildsLeft(req), pick }));
    }));
    router.post('/spaces/new', ...action(async (req, res) => {
        const body = req.body || {};
        const prompt = String(body.prompt || '').trim();
        if (body.template) {
            const t = templates.get(String(body.template));
            if (!t) throw new ApiError(404, 'space.template_not_found', 'no such template');
            const space = await spaces.create(req.viewer, { name: t.name, description: t.description, instructions: t.instructions || '', capabilities: t.capabilities, files: templates.files(t.id), template: t.id });
            return res.redirect(303, `/spaces/${space.slug}/edit`);
        }
        const again = (error) => html(res, 422, render.newPage({ viewer: req.viewer, templates: templates.list(), csrf: csrfOf(req), aiOn: ai.enabled(), buildsLeft: 0, error, prompt }));
        if (prompt.length < 8) return again('Describe your space in a sentence or two (what it does, who uses it, how it should look).');
        if (!ai.enabled()) return again('OpenVibe AI is not available right now. Start from a template instead.');
        if (!(await spaces.spend(`build:${req.viewer.subject}`, limits.aiBuildsPerDay))) return again(`You have used today's ${limits.aiBuildsPerDay} AI builds. Start from a template, or try again tomorrow.`);
        const t = templates.get('blank');
        const space = await spaces.create(req.viewer, { name: 'New space', description: '', capabilities: t.capabilities, files: templates.files('blank'), template: null });
        const runId = await ai.build(spaces.personOf(req.viewer), { prompt, spaceId: space.id });
        await spaces.startBuild(space, runId, prompt);
        res.redirect(303, `/spaces/${space.slug}/edit`);
    }));

    router.get('/spaces/mine', view(async (req, res) => {
        if (!signedIn(req)) throw new ApiError(401, 'auth.required', 'sign in first');
        html(res, 200, render.minePage({ spaces: await spaces.mine(req.viewer) }));
    }));

    router.get('/spaces/:slug', view(async (req, res) => {
        const { space, owner } = await spaces.load(req.viewer, req.params.slug, 'read');
        const forkedFrom = space.forked_from ? await spaces.get(space.forked_from) : null;
        html(res, 200, render.spacePage({ viewer: signedIn(req) ? req.viewer : null, space, owner, url: spaces.urlOf(space), csrf: csrfOf(req), forkedFrom: forkedFrom && forkedFrom.site_id ? forkedFrom : null }));
    }));

    router.get('/spaces/:slug/edit', view(async (req, res) => {
        if (!signedIn(req)) throw new ApiError(401, 'auth.required', 'sign in first');
        const { space } = await spaces.load(req.viewer, req.params.slug, 'own');
        html(res, 200, render.editorPage({ space, files: await spaces.files(space), csrf: csrfOf(req), canPublish: spaces.canPublish(req.viewer), url: spaces.urlOf(space), aiOn: ai.enabled(), buildsLeft: await buildsLeft(req), templates: templates.list() }));
    }));

    router.post('/spaces/:slug/fork', ...action(async (req, res) => {
        const { space } = await spaces.load(req.viewer, req.params.slug, 'read');
        const copy = await spaces.fork(req.viewer, space);
        res.redirect(303, `/spaces/${copy.slug}/edit`);
    }));

    // ── The editor's JSON calls ──
    const own = async (req) => (await spaces.load(req.viewer, req.params.slug, 'own')).space;
    router.put('/spaces/:slug/files', ...api(async (req) => {
        const space = await own(req);
        if (space.building_run_id) throw new ApiError(409, 'space.building', 'the AI is changing this space; wait for it to finish');
        return { files: await spaces.saveFiles(req.viewer, space, (req.body || {}).files) };
    }));
    router.put('/spaces/:slug/settings', ...api(async (req) => ({ space: settingsOut(await spaces.updateSettings(req.viewer, await own(req), req.body || {})) })));
    router.post('/spaces/:slug/ai', ...api(async (req) => {
        const space = await own(req);
        const prompt = String((req.body || {}).prompt || '').trim();
        if (prompt.length < 3) throw new ApiError(422, 'space.prompt_required', 'say what to change');
        if (space.building_run_id) throw new ApiError(409, 'space.building', 'the AI is already changing this space');
        if (!(await spaces.spend(`build:${req.viewer.subject}`, limits.aiBuildsPerDay))) throw new ApiError(429, 'quota', `you have used today's ${limits.aiBuildsPerDay} AI builds; try again tomorrow`);
        const runId = await ai.build(spaces.personOf(req.viewer), { prompt, name: space.name, current: await spaces.files(space), spaceId: space.id });
        await spaces.startBuild(space, runId, prompt);
        return { building: true };
    }));
    router.get('/spaces/:slug/ai', ...api(async (req) => {
        const space = await own(req);
        if (!space.building_run_id) return { status: 'idle' };
        const runId = space.building_run_id;
        const r = await ai.result(runId);
        if (r.status === 'running') {
            if (Number(space.updated_at) < ctx.store.now() - BUILD_STALE) { await spaces.failBuild(space, runId); return { status: 'failed', message: 'The AI took too long. Try again, perhaps with a smaller change.' }; }
            return { status: 'running' };
        }
        if (r.status === 'succeeded') {
            try {
                await spaces.finishBuild(space, runId, r.output);
            } catch (err) {
                await spaces.failBuild(space, runId);
                return { status: 'failed', message: `The AI's answer was not a working space (${err.message}). Try again.` };
            }
            const fresh = await spaces.get(space.id);
            return { status: 'done', space: settingsOut(fresh), files: await spaces.files(fresh) };
        }
        await spaces.failBuild(space, runId);
        return { status: 'failed', message: r.error === 'quota.exceeded' ? 'Your OpenVibe AI allowance for today is used up.' : 'The AI could not build that. Try again, or describe it differently.' };
    }));
    router.post('/spaces/:slug/publish', ...api(async (req) => {
        const out = await spaces.publish(req.viewer, await own(req), { traceparent: req.ov ? req.ov.traceparent : undefined });
        return { space: settingsOut(out.space), url: out.url };
    }));
    router.post('/spaces/:slug/unpublish', ...api(async (req) => ({ space: settingsOut(await spaces.unpublish(req.viewer, await own(req))) })));
    router.post('/spaces/:slug/delete', ...api(async (req) => { await spaces.remove(req.viewer, await own(req)); return { deleted: true }; }));
    router.post('/spaces/:slug/preview', ...api(async (req) => {
        const space = await own(req);
        const b = req.body || {};
        const person = spaces.personOf(req.viewer);
        // OV.fn in the preview: the editor's copy of functions/<name>.js (unsaved changes too), run as the maker.
        if (b.op === 'fn.call') {
            const a = b.args && typeof b.args === 'object' ? b.args : {};
            const name = String(a.name || '');
            if (!ctx.spaceFunctions.NAME_RE.test(name)) throw new ApiError(404, 'space.function_not_found', 'function names are 1-40 characters: a-z, 0-9 and "-"');
            const saved = (await spaces.files(space)).find((f) => f.path === `functions/${name}.js`);
            const source = typeof a.source === 'string' ? a.source : saved && saved.content;
            if (typeof source !== 'string') throw new ApiError(404, 'space.function_not_found', `this space has no functions/${name}.js`);
            const query = {};
            if (a.query && typeof a.query === 'object') for (const [k, v] of Object.entries(a.query).slice(0, 50)) query[String(k).slice(0, 100)] = String(v).slice(0, 1000);
            const request = { method: a.method === 'POST' ? 'POST' : 'GET', path: `/api/${name}`, query, headers: {}, body: a.body === undefined ? null : a.body };
            return { result: await ctx.spaceFunctions.call(space, name, source, request, {
                visitor: { person, capabilities: spaces.CAPABILITIES }, caller: person.subject,
                perMinute: limits.fnCallsPerMinute, perCallerPerMinute: limits.fnCallsPerCallerPerMinute,
            }) };
        }
        return { result: await data.run(String(b.op || ''), b.args || {}, { space, person, capabilities: spaces.CAPABILITIES, owner: true }) };
    }));

    // ── A visitor signs in to a published space ──
    async function connectTarget(req) {
        const space = await spaces.getBySlug(req.params.slug);
        if (!space || !space.site_id) throw new ApiError(404, 'space.not_found', 'no such space, or it is not published');
        const src = req.method === 'POST' ? (req.body || {}) : req.query;
        const challenge = String(src.challenge || '');
        const state = String(src.state || '');
        if (!CHALLENGE_RE.test(challenge) || !STATE_RE.test(state)) throw new ApiError(400, 'space.invalid_connect', 'this sign-in link is incomplete; go back to the space and press its sign-in button again');
        return { space, challenge, state, returnPath: cleanReturn(src.return) };
    }
    const backTo = (space, returnPath, code, state) => `${spaces.urlOf(space)}${returnPath}${code ? `#ov_code=${encodeURIComponent(code)}&ov_state=${encodeURIComponent(state)}` : ''}`;
    router.get('/spaces/:slug/connect', view(async (req, res) => {
        const t = await connectTarget(req);
        if (!signedIn(req)) throw new ApiError(401, 'auth.required', 'sign in first');
        const person = spaces.personOf(req.viewer);
        const granted = await data.grantedFor(t.space, person.subject);
        const wanted = spaces.capsOf(t.space.capabilities);
        if (granted && wanted.every((c) => granted.includes(c))) {
            const code = await data.approve(t.space, person, { challenge: t.challenge });
            return res.redirect(303, backTo(t.space, t.returnPath, code, t.state));
        }
        res.set('X-Frame-Options', 'DENY');
        html(res, 200, render.connectPage({ viewer: req.viewer, space: t.space, csrf: csrfOf(req), challenge: t.challenge, state: t.state, returnPath: t.returnPath }));
    }));
    router.post('/spaces/:slug/connect', ...action(async (req, res) => {
        const t = await connectTarget(req);
        if (req.body.decision !== 'allow') return res.redirect(303, backTo(t.space, t.returnPath));
        const code = await data.approve(t.space, spaces.personOf(req.viewer), { challenge: t.challenge });
        res.redirect(303, backTo(t.space, t.returnPath, code, t.state));
    }));

    return router;
}

module.exports = { createSpacesPages, cleanReturn };
