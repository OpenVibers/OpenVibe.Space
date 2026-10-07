'use strict';

/**
 * What Space tells crawlers, feed readers and language models: the robots.txt disallow set,
 * the /llms.txt and /llms-full.txt sections, the sitemap rows (cached ~1h) and the feed items.
 * Only data lives here; openvibe-shared/seo writes every format (server/app.js, server/forum/routes.js).
 */
const config = require('./config');
const { abs } = require('./render/layout');
const { isoDate } = require('./render/jsonld');

const SITEMAP_TTL_MS = 60 * 60 * 1000;
const ROBOTS_DISALLOW = ['/api/', '/auth/', '/s/*/new', '/*?sso='];
const SUMMARY = 'The forums of the OpenVibe network: public and members-only spaces, their threads and replies, votes and categories. The network Pulse feed lives on OpenVibe.Community.';
const CONTENT_LABELS = 'Threads and replies written by services for the OpenVibe AI carry origin "ai" and are labelled as AI-generated; everything else was written by people.';

// The forum service (server/forum/service.js), when the app has one: threads join the sitemap,
// the feeds and /llms-full.txt.
let _forum = null;
function useForum(forum) { _forum = forum || null; resetCaches(); }

// ── llms.txt / llms-full.txt (llmstxt.org) ───────────────────
function llmsSections() {
    const u = config.baseUrl;
    return [
        { title: 'Browse', links: [
            { title: 'Spaces', url: `${u}/s`, note: 'the board index: every public space, grouped' },
            { title: 'Pulse', url: `${config.communityUrl}/pulse`, note: 'network activity, on OpenVibe.Community' },
        ] },
        { title: 'Machine-readable', links: [
            { title: 'Sitemap', url: `${u}/sitemap.xml` },
            { title: 'Latest threads (RSS)', url: `${u}/s/feed.xml` },
            { title: 'Full text for language models', url: `${u}/llms-full.txt` },
        ] },
    ];
}

/** The latest public threads in full (nothing gated). */
async function llmsFullSections() {
    const { markdownToText } = require('./render/markdown');
    const sections = [{ title: 'Content labels', pages: [{ title: 'Who wrote what', url: '/s', text: CONTENT_LABELS }] }];
    if (_forum) {
        const threads = await _forum.recentPublic({ limit: 50 });
        sections.push({ title: 'Latest threads', pages: threads.map((t) => ({
            title: `${t.title} (${t.space_name})`, url: abs(`/s/${t.space_slug}/t/${t.slug}`), text: markdownToText(t.opening, Infinity),
        })) });
    }
    return sections;
}

// ── sitemap.xml rows (cached ~1h) ────────────────────────────
let _sitemap = null, _sitemapAt = 0;
async function buildSitemapRows() {
    const rows = [];
    const add = (loc, lastmod, changefreq, priority) => rows.push({ loc: abs(loc), lastmod, changefreq, priority });
    add('/s', null, 'hourly', '1.0');
    if (_forum) {
        for (const s of await _forum.publicSpaces()) add(`/s/${s.slug}`, s.last_activity_at || null, 'hourly', '0.7');
        for (const t of await _forum.recentPublic({ limit: 1000 })) add(`/s/${t.space_slug}/t/${t.slug}`, isoDate(t.last_activity_at || t.created_at), 'daily', '0.6');
    }
    return rows;
}
/** The sitemap rows, rebuilt at most hourly; a failed rebuild keeps serving the last good rows. */
async function sitemapRows() {
    if (!_sitemap || Date.now() - _sitemapAt > SITEMAP_TTL_MS) {
        try { _sitemap = await buildSitemapRows(); _sitemapAt = Date.now(); }
        catch (e) { console.warn('[SEO] sitemap build failed:', e.message); if (!_sitemap) throw e; }
    }
    return _sitemap;
}

// ── Feed items (openvibe-shared/seo feedXml, 2.5.0 item shape) ──
/** Threads (forum.recentPublic rows) for /s/feed.xml and /s/:space/feed.xml. */
function threadFeedItems(threads) {
    const { markdownToText } = require('./render/markdown');
    return threads.map((t) => {
        const url = abs(`/s/${t.space_slug}/t/${t.slug}`);
        const description = markdownToText(t.opening, 300);
        return { title: t.title, link: url, guid: url, description, content: description,
            author: undefined, published: isoDate(t.created_at), updated: isoDate(t.last_activity_at || t.created_at) };
    });
}

function resetCaches() { _sitemap = null; _sitemapAt = 0; }

module.exports = { ROBOTS_DISALLOW, SUMMARY, CONTENT_LABELS, llmsSections, llmsFullSections, sitemapRows, threadFeedItems, useForum, resetCaches };
