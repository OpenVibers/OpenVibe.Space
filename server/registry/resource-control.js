'use strict';
/**
 * Space's control API (ADR-048, plan T13 step 10; capability space.resource.control):
 *
 *   POST /api/v1/resources/control   common.resource-control-request@1 → common.resource-control-result@1
 *
 * From a first-party service (OpenVibe.Services) acting for the person in on_behalf_of, on a space.site, space.deploy or
 * space.domain named by its OVRN. 200 for every outcome; a malformed request is a 400 problem.
 *
 *   delete   exactly as the API's DELETE /api/v1/sites/:id, /deploys/:id and /domains/:id, acting as that person: a
 *            site stops serving at once and its deploys and domains go with it. Space's own rules refuse the deploy a
 *            site is serving (deploy.active), a site's default domain (domain.default) and anything taken down.
 *
 * Any other action is refused `control.unsupported_action`. Space decides by its own project roles (deleting needs
 * maintainer or owner; domain/access.js), so a person who is not a member is refused as not found, never confirmed to
 * exist; and only inside the project the OVRN names. `dry_run` checks the role and those rules without applying. The
 * first answer per (caller, project, idempotency_key) is kept in space_control_log and returned for a repeat; the same
 * key with another request is refused `control.idempotency_conflict`.
 */
const crypto = require('crypto');
const express = require('express');
const contracts = require('openvibe-contracts');
const { ApiError } = require('../http/errors');

const SERVICE = 'space';
const CAPABILITY = 'space.resource.control';
const USER_SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const TYPES = { site: /^sit_[0-9A-HJKMNP-TV-Z]{26}$/, deploy: /^dpl_[0-9A-HJKMNP-TV-Z]{26}$/, domain: /^dom_[0-9A-HJKMNP-TV-Z]{26}$/ };

function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
}
const digestOf = (request) => crypto.createHash('sha256')
    .update(canonical({ ...request, idempotency_key: undefined, confirmation_id: undefined, trace_id: undefined })).digest('hex');

function router({ guard, now = () => Date.now() }) {
    const r = express.Router();
    const json = express.json({ limit: '16kb' });
    const iso = () => new Date(now()).toISOString();
    const result = (request, state, extra = {}) => ({ action: request.action, ...(request.resource ? { resource: request.resource } : {}), state, at: iso(), ...extra });
    const problem = (status, code, detail) => ({ type: `https://openvibe.network/problems/${code}`, title: code, status, code, detail });
    const unknown = (request) => result(request, 'refused', { problem: problem(404, 'resources.unknown_resource', `no ${request.resource || request.resource_kind} that this person may delete`) });

    /** A person's control request, judged by Space's own roles exactly as an API call they made through a service. */
    async function decide(ctx, viewer, request) {
        const parsed = contracts.resources.parse(request.resource || '');
        if (!parsed || parsed.service !== SERVICE || !TYPES[parsed.type] || !TYPES[parsed.type].test(parsed.id)) return unknown(request);
        if (request.action !== 'delete') {
            return result(request, 'refused', { problem: problem(422, 'control.unsupported_action', `a ${parsed.type} takes delete, not ${request.action}`) });
        }
        const person = request.on_behalf_of;
        if (!person || person.type !== 'user' || !USER_SUBJECT_RE.test(String(person.id || ''))) {
            return result(request, 'refused', { problem: problem(403, 'control.no_person', 'on_behalf_of must name the person acting') });
        }
        if (parsed.project_id !== request.project_id) return unknown(request);
        const as = { kind: 'service', service: viewer.service, claims: viewer.claims, subject: person.id, env: viewer.env, staff: false };
        try {
            // Load with the role deleting needs (maintain): a non-member is a 404 there, a lesser role a 403.
            const loaded = parsed.type === 'site' ? await ctx.sites.load(as, parsed.id, 'maintain')
                : parsed.type === 'deploy' ? await ctx.deploys.load(as, parsed.id, 'maintain')
                    : await ctx.domains.load(as, parsed.id, 'maintain');
            const row = loaded[parsed.type];
            if (!row || row.project_id !== parsed.project_id) return unknown(request);
            if (request.dry_run) {
                if (parsed.type !== 'domain') await ctx.takedowns.assertDeletable(as, { site: loaded.site || row });
                if (parsed.type === 'deploy' && loaded.site && loaded.site.active_deploy_id === row.id) throw new ApiError(409, 'deploy.active', 'this deploy is being served: activate another one first');
                if (parsed.type === 'domain' && row.kind === 'default') throw new ApiError(409, 'domain.default', 'the default domain goes away only with the site');
                return result(request, 'done', { result: { dry_run: true, would: `delete the ${parsed.type}` } });
            }
            const out = parsed.type === 'site' ? await ctx.sites.remove(as, parsed.id, { deploys: ctx.deploys })
                : parsed.type === 'deploy' ? await ctx.deploys.remove(as, parsed.id)
                    : await ctx.domains.remove(as, parsed.id);
            return result(request, 'done', { result: { status: 'deleted', changed: true, ...(out && out.objects_removed != null ? { objects_removed: out.objects_removed } : {}) } });
        } catch (err) {
            if (!(err instanceof ApiError)) throw err;
            if (err.status === 404) return unknown(request);
            return result(request, 'refused', { problem: problem(err.status, err.code, err.message) });
        }
    }

    /** First-party only: a person holds no service capability (as at the resource index). */
    function firstParty(req, res, next) {
        const v = req.viewer;
        if (v && v.kind === 'service' && String(v.service || '').startsWith('svc:')) return next();
        if (!v || v.kind === 'anonymous') return contracts.http.sendProblem(res, 401, 'auth.required', { detail: 'control requests come from first-party services: present a service token for audience openvibe.space', ctx: req.ov });
        return contracts.http.sendProblem(res, 403, 'capability.denied', { detail: `${CAPABILITY} is first-party and requires a service token`, ctx: req.ov });
    }

    r.post('/control', firstParty, guard, json, async (req, res, next) => {
        try {
            res.set('Cache-Control', 'no-store');
            const ctx = req.app.locals.ctx;
            const db = ctx.store.db;
            const request = req.body;
            const check = contracts.resources.checkControlRequest(request || {});
            if (!check.valid) return contracts.http.sendProblem(res, 400, 'control.bad_request', { detail: JSON.stringify(check.errors).slice(0, 500), ctx: req.ov });
            const caller = req.viewer.service;
            const digest = digestOf(request);
            const seen = await db.prepare('SELECT digest, response FROM space_control_log WHERE caller = ? AND project_id = ? AND idempotency_key = ?')
                .get(caller, request.project_id, request.idempotency_key);
            if (seen) {
                if (seen.digest !== digest) return contracts.http.sendProblem(res, 409, 'control.idempotency_conflict', { detail: 'this idempotency_key was used for another request', ctx: req.ov });
                return res.json(typeof seen.response === 'string' ? JSON.parse(seen.response) : seen.response);
            }
            const answer = await decide(ctx, req.viewer, request);
            await db.prepare(`INSERT INTO space_control_log (caller, project_id, idempotency_key, digest, response, created_at)
                VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(caller, request.project_id, request.idempotency_key, digest, JSON.stringify(answer), now());
            return res.json(answer);
        } catch (err) { return next(err); }
    });
    return r;
}

module.exports = { router, CAPABILITY, digestOf };
