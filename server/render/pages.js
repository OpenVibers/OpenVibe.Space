'use strict';

/**
 * Page templates. Plain template strings, every value escaped, no framework. The markup is the whole
 * page for crawlers and no-JS readers; the shared Frame adds the navbar, footer and theme.
 *
 * Space publishes one page of its own while it is rebuilt: the home page, which says what Space will
 * host and points at the forum on OpenVibe.Community. It claims nothing Space does not have.
 */
const config = require('../config');
const { renderPage, escapeHtml: esc } = require('./layout');

const FORUM_URL = `${config.communityUrl}/s`;
const FORUM_LABEL = FORUM_URL.replace(/^https?:\/\//, '');

/** The home page: what Space will host, and where the forum went. */
function homePage() {
    const body = `
<section class="hero">
  <p class="eyebrow">OpenVibe.Space</p>
  <h1>Code and dynamic pages for the OpenVibe network</h1>
  <p class="lede">Space is being rebuilt to host <strong>code</strong> and <strong>dynamic pages</strong>, and <strong>spaces</strong>: apps people build that use their OpenVibe account, the network's services and the SDK.</p>
  <p class="forum-note">The forum moved to OpenVibe.Community → <a href="${esc(FORUM_URL)}">${esc(FORUM_LABEL)}</a></p>
  <p class="muted">Nothing is published here yet.</p>
</section>`;
    return renderPage({ canonicalPath: '/', active: 'home', body });
}

// ── Errors ───────────────────────────────────────────────────
function errorPage({ status = 500, title = 'Something went wrong', message = '', links = true }) {
    const body = `
<section class="error">
  <p class="eyebrow">${status}</p>
  <h1>${esc(title)}</h1>
  ${message ? `<p class="lede">${esc(message)}</p>` : ''}
  ${links ? `<p><a class="btn" href="/">Home</a> <a class="btn" href="${esc(FORUM_URL)}">The forum</a></p>` : ''}
</section>`;
    return renderPage({ title, description: message || title, canonicalPath: '/', robots: 'noindex,nofollow', footerVariant: 'compact', body });
}

module.exports = { homePage, errorPage };
