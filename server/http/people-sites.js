'use strict';
/**
 * A person's live sites, public (plan §AD.10 step 6: a hosted site on the person's profile, after the feed):
 *
 *   GET /api/v1/people/:subject/sites   → { sites: [{ name, url, hostname, updated_at }] }
 *
 * The sites in the person's own projects that anyone can open now: active, a ready deploy live, not a scratch site, not
 * in a sandbox project and not taken down. The same sites whose going live is public news (space.deploy.activated is
 * public for exactly these, server/domain/deploys.js), newest deploy first, at most 12. No sign-in, open to any origin,
 * cached a minute: OpenVibe.Network's profile reads it (server/profile/public.js there).
 */
const express = require('express');

const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const MAX = 12;

function createPeopleSites({ db, sites, takedowns, config }) {
    const router = express.Router();
    const q = db.prepare(`SELECT s.id, s.project_id, s.name, s.updated_at, d.created_at AS deployed_at
        FROM space_sites s
        JOIN space_projects p ON p.id = s.project_id
        JOIN space_deploys d ON d.id = s.active_deploy_id
        WHERE p.owner_subject = ? AND p.status = 'active' AND p.environment = 'production'
          AND s.status = 'active' AND NOT s.scratch AND d.state = 'ready'
        ORDER BY d.created_at DESC, s.seq DESC
        LIMIT ?`);
    const siteUrl = (hostname) => {
        const u = new URL(config.baseUrl);
        return `${u.protocol}//${hostname}${u.port ? `:${u.port}` : ''}/`;
    };
    router.get('/people/:subject/sites', async (req, res, next) => {
        try {
            res.set('Access-Control-Allow-Origin', '*');
            if (!SUBJECT_RE.test(String(req.params.subject))) return res.status(404).set('Cache-Control', 'public, max-age=60').json({ error: 'space.person_not_found', detail: 'No such person' });
            const rows = await q.all(req.params.subject, MAX + 8);
            const out = [];
            for (const r of rows) {
                if (out.length >= MAX) break;
                if (await takedowns.ofSite(r)) continue;
                const hostname = sites.defaultHostname(r.name);
                out.push({ name: r.name, hostname, url: siteUrl(hostname), updated_at: new Date(Number(r.deployed_at || r.updated_at)).toISOString() });
            }
            res.set('Cache-Control', 'public, max-age=60').json({ sites: out });
        } catch (err) { next(err); }
    });
    return router;
}

module.exports = { createPeopleSites };
