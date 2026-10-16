'use strict';

/**
 * What Space tells crawlers and language models: the robots.txt disallow set, the /llms.txt and
 * /llms-full.txt sections and the sitemap rows. Only data lives here; openvibe-shared/seo writes
 * every format (server/app.js).
 *
 * Space is where people make spaces (small apps on their OpenVibe account, server/spaces/) and serves static hosting
 * (staff until the public launch). The forum is
 * OpenVibe.Community's (owner decision, 2026-10-08), so nothing forum
 * shaped appears here: no /s entries, no feeds.
 */
const config = require('./config');
const { abs } = require('./render/layout');

const ROBOTS_DISALLOW = ['/api/', '/auth/', '/dashboard', '/projects/', '/sites/', '/deploys/', '/domains/', '/preview/', '/*?sso=', '/spaces/new', '/spaces/mine', '/spaces/*/edit', '/spaces/*/connect', '/_openvibe/'];
const SUMMARY = 'OpenVibe.Space is where people make spaces: small apps on their OpenVibe account, built by OpenVibe AI from a description or started from a template and changed in a browser editor, that sign visitors in with OpenVibe, keep shared lists and private data, and talk to OpenVibe AI. It also serves tested static hosting (immutable deploys, rollback, previews, Git ingest, verified custom domains), open to OpenVibe staff until the public launch. The forum that used to live here is on OpenVibe.Community.';

// ── llms.txt / llms-full.txt (llmstxt.org) ───────────────────
function llmsSections() {
    const u = config.baseUrl;
    return [
        { title: 'This site', links: [
            { title: 'Home', url: `${u}/`, note: 'spaces and static hosting' },
            { title: 'Spaces', url: `${u}/spaces`, note: 'the gallery of published spaces and the templates' },
            { title: 'Make a space', url: `${u}/spaces/new`, note: 'describe it to the AI builder, or start from a template (sign-in required)' },
        ] },
        { title: 'The network', links: [
            { title: 'The forum', url: `${config.communityUrl}/s`, note: 'OpenVibe.Community hosts the forum' },
            { title: 'OpenVibe.Network', url: config.networkUrl, note: 'identity, accounts and sign-in' },
        ] },
        { title: 'Machine-readable', links: [
            { title: 'Sitemap', url: `${u}/sitemap.xml` },
            { title: 'Full text for language models', url: `${u}/llms-full.txt` },
        ] },
    ];
}

async function llmsFullSections() {
    return [{ title: 'OpenVibe.Space', pages: [{ title: 'What Space does', url: '/', text: SUMMARY }] }];
}

// ── sitemap.xml rows ─────────────────────────────────────────
/** The home page, the spaces gallery and every published public space's page. */
async function sitemapRows(releaseLastmod, db = null) {
    const rows = [
        { loc: abs('/'), lastmod: releaseLastmod, changefreq: 'weekly', priority: '1.0' },
        { loc: abs('/spaces'), lastmod: releaseLastmod, changefreq: 'daily', priority: '0.9' },
    ];
    let spaces = [];
    try {
        spaces = await (db || require('./db').getDb()).prepare(`SELECT a.slug, a.updated_at FROM space_apps a JOIN space_sites s ON s.id = a.site_id
            WHERE a.status = 'active' AND a.visibility = 'public' AND s.status = 'active' AND NOT EXISTS (SELECT 1 FROM space_takedowns t WHERE t.lifted_at IS NULL AND ((t.target_kind = 'site' AND t.target_id = s.id) OR (t.target_kind = 'project' AND t.target_id = s.project_id)))
            ORDER BY a.published_at DESC LIMIT 5000`).all();
    } catch { spaces = []; }
    for (const r of spaces) rows.push({ loc: abs(`/spaces/${r.slug}`), lastmod: new Date(Number(r.updated_at)).toISOString(), changefreq: 'weekly', priority: '0.6' });
    return rows;
}

module.exports = { ROBOTS_DISALLOW, SUMMARY, llmsSections, llmsFullSections, sitemapRows };
