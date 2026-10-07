'use strict';

/**
 * JSON-LD builders for the pages (WebSite, breadcrumbs, threads and their authors) and the
 * two small text helpers they share with the templates. renderPage emits them through
 * openvibe-shared/seo's jsonLdTag (via headTags).
 */
const config = require('../config');
const { abs, SITE_NAME, DEFAULT_DESCRIPTION } = require('./layout');

function isoDate(v) {
    if (!v) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(String(v)) ? `${String(v).replace(' ', 'T')}Z` : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function clean(s, max) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── JSON-LD ──────────────────────────────────────────────────
function websiteLd() {
    return {
        '@context': 'https://schema.org', '@type': 'WebSite',
        name: SITE_NAME, url: `${config.baseUrl}/s`, description: DEFAULT_DESCRIPTION,
        publisher: { '@type': 'Organization', name: 'OpenVibe', url: 'https://openvibe.network' },
    };
}

function breadcrumbLd(items) {
    return {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: clean(it.name, 90), item: abs(it.url) })),
    };
}

/** Who wrote a thread or post, for JSON-LD: a person, the AI label (never a person), or anonymous. */
function discussionAuthorLd(a) {
    if (!a) return { '@type': 'Person', name: 'Anonymous' };
    if (a.is_ai) return { '@type': 'Organization', name: a.display_name || 'OpenVibe AI' };
    const name = a.display_name || a.username || 'Anonymous';
    return a.username ? { '@type': 'Person', name, url: `${config.liveUrl}/@${encodeURIComponent(a.username)}` } : { '@type': 'Person', name };
}

/** DiscussionForumPosting for a thread page: the opening post, counters and the replies on the page. */
function threadLd({ space, thread, posts, opening, description }) {
    const { markdownToText } = require('./markdown');
    const url = abs(`/s/${space.slug}/t/${thread.slug}`);
    const replies = posts.filter((p) => !p.is_opening && !p.deleted).slice(0, 20);
    return {
        '@context': 'https://schema.org',
        '@type': 'DiscussionForumPosting',
        headline: clean(thread.title, 110),
        text: opening && !opening.deleted ? markdownToText(opening.body_markdown, 5000) : description,
        url,
        mainEntityOfPage: url,
        author: discussionAuthorLd(thread.author),
        datePublished: isoDate(thread.created_at) || undefined,
        dateModified: isoDate((opening && opening.updated_at) || thread.created_at) || undefined,
        isPartOf: { '@type': 'CollectionPage', name: space.name, url: abs(`/s/${space.slug}`) },
        commentCount: thread.reply_count,
        interactionStatistic: [
            { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: thread.reply_count },
            { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: Math.max(Number(thread.score) || 0, 0) },
        ],
        comment: replies.map((p) => ({
            '@type': 'Comment',
            text: markdownToText(p.body_markdown, 2000),
            author: discussionAuthorLd(p.author),
            datePublished: isoDate(p.created_at) || undefined,
            url: `${url}#post-${p.id}`,
        })),
    };
}

module.exports = { isoDate, clean, websiteLd, breadcrumbLd, threadLd, discussionAuthorLd };
