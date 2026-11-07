'use strict';
/**
 * Space's builder API: what the person's own agent works through (plan 2026-10-22 §Z stage Z1).
 *
 *   GET    /api/v1/builder/spaces                 the person's own spaces
 *   POST   /api/v1/builder/spaces                 make a new one
 *   GET    /api/v1/builder/spaces/:id             one of them
 *   GET    /api/v1/builder/spaces/:id/files       its files
 *   GET    /api/v1/builder/spaces/:id/files/:path one file
 *   PUT    /api/v1/builder/spaces/:id/files       write its files (they replace the space's files as a whole)
 *   GET    /api/v1/builder/spaces/:id/preview     where it can be seen now
 *   POST   /api/v1/builder/spaces/:id/publish     ask to publish it (the person answers; nothing goes live until they do)
 *
 * (The address is /api/v1/builder/spaces because /api/v1/spaces was the forum's old API, which lives on
 * OpenVibe.Community now and is still redirected there.)
 *
 * The caller is OpenVibe.Actor, acting for the person it names in X-OV-Subject. Space reads that person and
 * touches nothing else: another person's space is the same 404 as one that does not exist. The capabilities
 * (space.build.read, space.build.create, space.build.write, space.build.publish) are checked on the token; the
 * writes go through the same path as Space's own editor, with the same limits and the same audit.
 *
 *   POST   /api/v1/agent/approvals/:id/decide   the person's answer to the agent's request to publish
 *
 * The answer comes from the Dock: OpenVibe.Actor passes it on with the person's own token, so Space sees the
 * person who owns the space, never a service deciding for them.
 */
const express = require('express');
const contracts = require('openvibe-contracts');
const { guard } = require('../auth/viewer');
const { ApiError } = require('../http/errors');

/** The person a call is for: the signed-in person, or the one a first-party service names in X-OV-Subject. */
function personOf(req) {
    const v = req.viewer;
    if (!v) return null;
    if (v.kind === 'user') return v.subject;
    if (v.kind === 'service' && typeof v.subject === 'string' && v.subject) return v.subject;
    return null;
}

function createSpacesBuilderApi({ config, spaces, steps = null, log = console }) {
    const router = express.Router();
    const json = express.json({ limit: '256kb' });

    const problem = (req, res, status, code, detail) => contracts.http.sendProblem(res, status, code, { detail, ctx: req.ov });
    const fail = (req, res, err) => {
        if (err instanceof ApiError || (err && Number.isInteger(err.status) && err.code)) {
            return contracts.http.sendProblem(res, err.status || 400, err.code || 'space.error', { detail: err.message, ctx: req.ov });
        }
        log.error('[Spaces builder]', err && err.stack ? err.stack : err);
        return contracts.http.sendProblem(res, 500, 'internal', { detail: 'Something went wrong on our side', ctx: req.ov });
    };
    const run = (fn) => async (req, res) => { try { const out = await fn(req, res); if (out !== undefined && !res.headersSent) res.status(200).set('Cache-Control', 'no-store').json(out); } catch (err) { fail(req, res, err); } };

    /** The person's own space by id. Another person's space is the same 404 as one that does not exist. */
    async function ownSpace(req) {
        const person = personOf(req);
        if (!person) throw new ApiError(401, 'auth.required', 'this work runs for one person; sign in');
        const space = await spaces.ownedOf(person, req.params.id);
        if (!space) throw new ApiError(404, 'space.not_found', 'no such space');
        return { person, space };
    }
    const out = (space) => ({
        id: space.id,
        slug: space.slug,
        name: space.name,
        description: space.description || '',
        published: Boolean(space.site_id),
        url: space.site_id ? spaces.urlOf(space) : `${config.baseUrl}/spaces/${encodeURIComponent(space.slug)}/edit`,
        updated_at: new Date(Number(space.updated_at)).toISOString(),
    });

    router.get('/', guard('space.build.read'), run(async (req) => {
        const person = personOf(req);
        if (!person) throw new ApiError(401, 'auth.required', 'sign in to see your spaces');
        const mine = await spaces.mineOf(person);
        return { spaces: mine.map(out) };
    }));

    router.post('/', guard('space.build.create'), json, run(async (req) => {
        const person = personOf(req);
        if (!person) throw new ApiError(401, 'auth.required', 'sign in to make a space');
        const body = req.body || {};
        const templates = require('./templates');
        const blank = templates.get('blank');
        const space = await spaces.create(spaces.viewerOf(person, { username: '', name: '' }), {
            name: String(body.name || 'New space').slice(0, 40),
            description: String(body.description || '').slice(0, 400),
            capabilities: blank.capabilities,
            files: templates.files('blank'),
            template: null,
        });
        return { space: out(space) };
    }));

    router.get('/:id', guard('space.build.read'), run(async (req) => ({ space: out((await ownSpace(req)).space) })));

    router.get('/:id/files', guard('space.build.read'), run(async (req) => {
        const { space } = await ownSpace(req);
        return { files: await spaces.files(space) };
    }));

    router.get('/:id/files/:path(*)', guard('space.build.read'), run(async (req) => {
        const { space } = await ownSpace(req);
        const path = String(req.params.path || '').replace(/^\.?\//, '');
        const files = await spaces.files(space);
        const one = files.find((f) => f.path === path);
        if (!one) throw new ApiError(404, 'space.file_not_found', 'no such file in this space');
        return { files: [one] };
    }));

    router.put('/:id/files', guard('space.build.write'), json, run(async (req) => {
        const { person, space } = await ownSpace(req);
        const body = req.body || {};
        const files = await spaces.saveFiles(spaces.viewerOf(person, space), space, body.files);
        if (steps) await steps.working({ space, person });
        return { files };
    }));

    router.get('/:id/preview', guard('space.build.read'), run(async (req) => {
        const { space } = await ownSpace(req);
        const files = await spaces.files(space);
        return {
            url: space.site_id ? spaces.urlOf(space) : `${config.baseUrl}/spaces/${encodeURIComponent(space.slug)}/edit`,
            files: files.map((f) => f.path),
            published: Boolean(space.site_id),
        };
    }));

    router.post('/:id/publish', guard('space.build.publish'), json, run(async (req) => {
        const { person, space } = await ownSpace(req);
        // While public hosting is off, nothing can go live (an owner decision): the agent is told now, instead
        // of asking the person to approve something that could not succeed.
        const staff = req.viewer.kind === 'user' && req.viewer.staff;
        if (!config.publicHosting && !staff) {
            throw new ApiError(403, 'space.not_launched', 'Publishing a space at its own address opens with OpenVibe.Space\'s public hosting; until then the space runs in its editor.');
        }
        const ask = await spaces.askPublish(person, space);
        if (steps) await steps.publishAsked({ space, person, request: ask });
        return { state: ask.state, approval_id: ask.id, url: ask.url || null, reason: ask.reason || null };
    }));

    return router;
}

/**
 * The person's answer to the agent's request to publish a space. OpenVibe.Actor passes it on with the person's
 * own token (the Dock's "Needs you" card), so Space sees the person who owns the space.
 *
 * Approving publishes the space now; declining leaves it as it is. Nothing goes live without the answer.
 */
function createApprovalsApi({ spaces, steps = null, log = console }) {
    const router = express.Router();
    const json = express.json({ limit: '16kb' });

    router.post('/:id/decide', guard('space.build.publish'), json, async (req, res) => {
        try {
            const person = personOf(req);
            if (!person) return contracts.http.sendProblem(res, 401, 'auth.required', { detail: 'sign in to answer', ctx: req.ov });
            const decision = String((req.body || {}).decision || '').trim().toLowerCase();
            if (decision !== 'approve' && decision !== 'decline') {
                return contracts.http.sendProblem(res, 422, 'space.approval.invalid', { detail: 'decision: approve or decline', ctx: req.ov });
            }
            const out = await spaces.decidePublish(person, req.params.id, decision);
            if (out.error) return contracts.http.sendProblem(res, out.status || 404, 'space.approval.not_found', { detail: out.error, ctx: req.ov });
            const space = out.space || null;
            if (steps && space) {
                await steps.publishAnswered({ space, person, request: { id: req.params.id }, approved: out.state === 'approved', reason: out.reason || null });
            }
            res.status(200).set('Cache-Control', 'no-store').json({ state: out.state, url: out.url || null, reason: out.reason || null });
        } catch (err) {
            log.error('[Spaces approvals]', err && err.stack ? err.stack : err);
            return contracts.http.sendProblem(res, 500, 'internal', { detail: 'Something went wrong on our side', ctx: req.ov });
        }
    });

    return router;
}

module.exports = { createSpacesBuilderApi, createApprovalsApi, personOf };
