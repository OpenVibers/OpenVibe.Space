'use strict';

/**
 * Page templates. Plain template strings, every user value escaped, no framework. The markup
 * is the whole page for crawlers and no-JS readers; public/js/space.js only adds the
 * comforts (in-place pagination, the reply form's upload path).
 *
 * What is left of the shared page layer after the forum moved off Community: the author and time
 * helpers every forum template uses, and the error page. Pastes, comments, submissions and their
 * pages stayed on OpenVibe.Community.
 */
const config = require('../config');
const ld = require('./jsonld');
const { renderPage } = require('./layout');
const { escapeHtml: esc } = require('./highlight');

// ── Small helpers ────────────────────────────────────────────
function timeAgo(v) {
    const iso = ld.isoDate(v);
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo ago`;
    return `${Math.floor(s / (86400 * 365))}y ago`;
}
function fmtDate(v) {
    const iso = ld.isoDate(v);
    if (!iso) return '';
    return new Date(iso).toUTCString().replace(/:\d\d GMT$/, ' UTC');
}
function timeTag(v) {
    const iso = ld.isoDate(v);
    return iso ? `<time datetime="${esc(iso)}" title="${esc(fmtDate(v))}">${esc(timeAgo(v))}</time>` : '';
}
function num(n) { return Number(n || 0).toLocaleString('en-US'); }
function authorName(p) { return p.display_name || p.username || 'Anonymous'; }
/** A person's picture at `size` px: their own, else the network's avatar address (a generated initial when none). */
function avatarUrl(p, size = 96) {
    if (!p) return null;
    if (p.avatar_url) return /^https?:\/\//i.test(p.avatar_url) ? p.avatar_url : `${config.liveUrl}${p.avatar_url.startsWith('/') ? '' : '/'}${p.avatar_url}`;
    return p.username ? `${config.networkUrl}/avatar/${encodeURIComponent(p.username)}?s=${size}` : null;
}
function authorHtml(p, { link = true } = {}) {
    const name = authorName(p);
    const initial = esc(name.trim()[0] || '?').toUpperCase();
    const avatarSrc = p.avatar_url ? (/^https?:\/\//i.test(p.avatar_url) ? p.avatar_url : `${config.liveUrl}${p.avatar_url.startsWith('/') ? '' : '/'}${p.avatar_url}`) : null;
    // No picture on the post's own record: the network's avatar address answers for any account (the person's
    // picture, or a generated initial), so an author looks the same here as on every other OpenVibe site.
    const netAvatar = !avatarSrc && p.username ? `${config.networkUrl}/avatar/${encodeURIComponent(p.username)}?s=44` : null;
    const avatar = (avatarSrc || netAvatar)
        ? `<img class="avatar" src="${esc(avatarSrc || netAvatar)}" alt="" loading="lazy" width="22" height="22">`
        : `<span class="avatar avatar-letter" aria-hidden="true">${initial}</span>`;
    const inner = `${avatar}<span>${esc(name)}</span>`;
    if (!link || !p.username) return `<span class="author">${inner}</span>`;
    return `<a class="author" href="${esc(config.liveUrl)}/@${encodeURIComponent(p.username)}" rel="author">${inner}</a>`;
}

// ── Errors ───────────────────────────────────────────────────
function errorPage({ status = 500, title = 'Something went wrong', message = '', links = true }) {
    const body = `
<section class="error">
  <p class="eyebrow">${status}</p>
  <h1>${esc(title)}</h1>
  ${message ? `<p class="lede">${esc(message)}</p>` : ''}
  ${links ? `<p><a class="btn" href="/s">All spaces</a></p>` : ''}
</section>`;
    return renderPage({ title, description: message || title, canonicalPath: '/', robots: 'noindex,nofollow', footerVariant: 'compact', body });
}

module.exports = { errorPage, timeAgo, timeTag, fmtDate, num, authorName, authorHtml, avatarUrl };
