'use strict';
/**
 * A website from a person's OpenVibe.Git repository, made by their agent (plan §AD.10 steps 1 and 2; the owner, 11-15:
 * "the agent can literally put any code on … use openvibe.space to host whatever it wants").
 *
 *   POST /api/v1/builder/sites/from-repo { repo: 'owner/name', branch?, folder?, name? }   (space.build.publish)
 *     → 201 { site: { id, name, url, dashboard }, publish }
 *
 * The caller is OpenVibe.Actor acting for the person it names in X-OV-Subject (the same rule as the builder API). Space
 * makes a site in the person's Spaces project, connects the repository and branch as its source, and tells OpenVibe.Git,
 * as that person, to send that folder of every push here (domain/git-publish.js). Nothing goes live by itself: each push
 * lands as the site's preview, made live by the person on its page. Host never fetches the repository.
 */
const express = require('express');
const contracts = require('openvibe-contracts');
const { guard } = require('../auth/viewer');
const { ApiError } = require('../http/errors');

const LABEL_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/;
const labelOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34).replace(/-+$/g, '');

function createRepoSitesApi({ config, spaces, sites, deploys, siteSources, gitPublish, log = console }) {
    const router = express.Router();
    const json = express.json({ limit: '16kb' });
    const fail = (req, res, err) => {
        if (err instanceof ApiError || (err && Number.isInteger(err.status) && err.code)) return contracts.http.sendProblem(res, err.status || 400, err.code || 'space.error', { detail: err.message, ctx: req.ov });
        log.error('[Space repo sites]', err && err.stack ? err.stack : err);
        return contracts.http.sendProblem(res, 500, 'internal', { detail: 'Something went wrong on our side', ctx: req.ov });
    };
    const personOf = (req) => {
        const v = req.viewer;
        if (v && v.kind === 'user') return v.subject;
        if (v && v.kind === 'service' && typeof v.subject === 'string' && v.subject) return v.subject;
        return null;
    };

    router.post('/from-repo', guard('space.build.publish'), json, async (req, res) => {
        try {
            const person = personOf(req);
            if (!person) throw new ApiError(401, 'auth.required', 'this work runs for one person; sign in');
            if (!gitPublish || !gitPublish.enabled) throw new ApiError(503, 'publish.off', 'publishing from OpenVibe.Git is not set up on this server');
            const body = req.body || {};
            const repo = gitPublish.repoOk(body.repo);
            const branch = String(body.branch || '').trim() || 'main';
            const folder = String(body.folder || '').trim();
            const viewer = spaces.viewerOf(person);
            const project = await spaces.spacesProject(viewer, { subject: person });
            // The site's name: the one asked for, else the repository's, made unique with a number.
            const base = labelOf(body.name) || labelOf(repo.split('/')[1]) || 'site';
            let site = null;
            for (let n = 0; n < 6 && !site; n++) {
                const name = n ? `${base}-${n + 1}` : base;
                if (!LABEL_RE.test(name)) continue;
                try { site = await sites.create(viewer, project, { name }); }
                catch (err) { if (!(err && (err.status === 409 || /taken|exists|in use/i.test(String(err.message))))) throw err; }
            }
            if (!site) throw new ApiError(409, 'site.name_taken', 'that name is taken; name the site another way');
            await siteSources.put(viewer, site.id, { provider: 'openvibe', repo_url: gitPublish.repoUrl(repo), ref: branch });
            let publish;
            try { publish = await gitPublish.set(viewer, repo, { site_id: site.id, branch, folder }); }
            catch (err) { await sites.remove(viewer, site.id, { deploys }).catch(() => {}); throw err; }
            const url = `https://${sites.defaultHostname(site.name)}/`;
            res.status(201).set('Cache-Control', 'no-store').json({
                site: { id: site.id, name: site.name, url, dashboard: `${config.baseUrl}/sites/${site.id}` },
                publish,
                note: 'Each push to the branch arrives as a preview; the person makes it live on the site\'s page.',
            });
        } catch (err) { fail(req, res, err); }
    });
    return router;
}

module.exports = { createRepoSitesApi };
