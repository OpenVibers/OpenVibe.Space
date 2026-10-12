'use strict';

/**
 * What Space tells crawlers and language models: the robots.txt disallow set, the /llms.txt and
 * /llms-full.txt sections and the sitemap rows. Only data lives here; openvibe-shared/seo writes
 * every format (server/app.js).
 *
 * Space serves static hosting for staff; dynamic pages and spaces are planned. The forum is
 * OpenVibe.Community's (owner decision, 2026-10-08), so nothing forum
 * shaped appears here: no /s entries, no feeds.
 */
const config = require('./config');
const { abs } = require('./render/layout');

const ROBOTS_DISALLOW = ['/api/', '/auth/', '/dashboard', '/projects/', '/sites/', '/deploys/', '/domains/', '/preview/', '/*?sso='];
const SUMMARY = 'OpenVibe.Space serves tested static hosting for OpenVibe staff: immutable deploys, rollback, previews, Git ingest and verified custom domains. Dynamic pages and spaces are planned. The forum moved to OpenVibe.Community.';

// ── llms.txt / llms-full.txt (llmstxt.org) ───────────────────
function llmsSections() {
    const u = config.baseUrl;
    return [
        { title: 'This site', links: [
            { title: 'Home', url: `${u}/`, note: 'static hosting for staff; dynamic pages and spaces planned' },
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
    return [{ title: 'OpenVibe.Space', pages: [{ title: 'What Space will host', url: '/', text: SUMMARY }] }];
}

// ── sitemap.xml rows ─────────────────────────────────────────
/** Space's only page is the home page. */
async function sitemapRows() {
    return [{ loc: abs('/'), lastmod: null, changefreq: 'weekly', priority: '1.0' }];
}

module.exports = { ROBOTS_DISALLOW, SUMMARY, llmsSections, llmsFullSections, sitemapRows };
