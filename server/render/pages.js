'use strict';

/**
 * Page templates. Plain template strings, every value escaped, no framework. The markup is the whole
 * page for crawlers and no-JS readers; the shared Frame adds the navbar, footer and theme.
 *
 * Space publishes one page of its own while it is rebuilt: the home page, which says what Space will
 * host and points at the forum on OpenVibe.Community and the developer platform. It claims nothing Space does not have.
 */
const config = require('../config');
const sc = require('openvibe-shared/showcase');
const { renderPage, escapeHtml: esc } = require('./layout');

const FORUM_URL = `${config.communityUrl}/s`;
const FORUM_LABEL = FORUM_URL.replace(/^https?:\/\//, '');
const SERVICES_URL = 'https://openvibe.services/';

/** The home page: what Space will host, and where things are today. Built from the network's showcase sections
 *  (openvibe-shared/showcase), so it reads like every other product home. It promises nothing as open: every card says
 *  what Space WILL host, and the live links go to the forum and the developer platform. */
function homePage() {
    const body = sc.hero({
        eyebrow: 'OpenVibe.Space · being rebuilt',
        title: 'Code and dynamic pages,',
        accent: 'on your OpenVibe account.',
        lede: 'OpenVibe.Space is being rebuilt to host static sites, dynamic pages and spaces: small apps people make that sign in with OpenVibe and use the network\'s services through the SDK. Nothing is hosted here yet.',
        actions: [
            { label: 'The forum is on OpenVibe.Community', href: FORUM_URL, primary: true, icon: 'fa-comments' },
            { label: 'Build on OpenVibe today', href: SERVICES_URL, icon: 'fa-code' },
        ],
        note: `The forum moved to OpenVibe.Community (${FORUM_LABEL}); every old forum address redirects there.`,
    }) + sc.features({
        title: 'What Space will host',
        lede: 'Each part is composed from services the network already runs. None of it is open yet.',
        items: [
            { icon: 'fa-file-code', title: 'Static sites', text: 'Upload a folder or connect a Git repository. Every deploy is kept, and the active one rolls back in one step.' },
            { icon: 'fa-bolt', title: 'Dynamic pages', text: 'Server functions that run on OpenVibe.Run workers, with their files kept on OpenVibe.Media.' },
            { icon: 'fa-cubes', title: 'Spaces', text: 'Small apps that sign people in with their OpenVibe account and ask only for the grants they need.' },
            { icon: 'fa-code-branch', title: 'Templates and forks', text: 'Start from a template, or fork someone\'s space and make it yours.' },
            { icon: 'fa-wand-magic-sparkles', title: 'Build with an agent', text: 'Describe a space and an agent on OpenVibe.Actor and OpenVibe.Codes builds it, with every change shown.' },
            { icon: 'fa-globe', title: 'Your own address', text: 'Each site gets a name under openvibe.website; a custom domain is verified before it is served.' },
        ],
    }) + sc.steps({
        title: 'Where things are today',
        items: [
            { title: 'The forum', href: FORUM_URL, text: 'Boards, threads, votes and moderation moved to OpenVibe.Community.' },
            { title: 'The developer platform', href: SERVICES_URL, text: 'Projects, credentials, grants and the SDK that spaces will be built on.' },
            { title: 'The source code', href: 'https://github.com/OpenVibers/OpenVibe.Space', text: 'Space is open source (AGPL-3.0): follow the rebuild there.' },
        ],
    });
    return renderPage({ canonicalPath: '/', active: 'home', styles: [sc.STYLESHEET], body });
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
