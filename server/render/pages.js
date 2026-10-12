'use strict';

/**
 * Page templates. Plain template strings, every value escaped, no framework. The markup is the whole
 * page for crawlers and no-JS readers; the shared Frame adds the navbar, footer and theme.
 *
 * The home page says what Space hosts today (static sites, staff-only until the public launch), how a deploy
 * works, the API and the quotas the engine enforces, and what comes next. It claims nothing Space does not have.
 */
const config = require('../config');
const sc = require('openvibe-shared/showcase');
const { renderPage, escapeHtml: esc } = require('./layout');

const FORUM_URL = `${config.communityUrl}/s`;
const FORUM_LABEL = FORUM_URL.replace(/^https?:\/\//, '');
const SERVICES_URL = 'https://openvibe.services/';

const MiB = 1024 * 1024;
const size = (n) => (n >= 1024 * MiB ? `${n / (1024 * MiB)} GB` : `${Math.round(n / MiB)} MB`);
let quotas = null;
/** The per-project quotas the engine enforces (server/hosting-config.js), read once. */
function defaultQuotas() {
    if (!quotas) quotas = require('../hosting-config').load().quotas;
    return quotas;
}

/** Hosting is working for staff; dynamic pages and spaces are the next stage. */
function homePage() {
    const q = defaultQuotas();
    const row = (label, key, fmt = String) => ({ label, values: [fmt(q.production[key]), fmt(q.sandbox[key])] });
    const body = sc.hero({
        eyebrow: 'OpenVibe.Space · static hosting',
        title: 'Publish a static site.',
        accent: 'Keep every deploy.',
        lede: 'Static site hosting is built and tested: immutable, content-addressed deploys, one-step rollback, previews, Git ingest and verified custom domains. It is open to OpenVibe staff only until public launch.',
        actions: [
            { label: 'Hosting dashboard', href: '/dashboard', primary: true, icon: 'fa-globe' },
            { label: 'How it works', href: '#how', icon: 'fa-route' },
        ],
        note: 'Public hosting follows abuse handling and a designated DMCA agent. Until then only OpenVibe staff can create projects.',
    }) + sc.steps({
        id: 'how',
        title: 'How a deploy works',
        items: [
            { title: 'Make a project and a site', text: 'A project holds sites and the people who may change them. Each site gets its own address under openvibe.website.' },
            { title: 'Upload, or connect Git', text: 'Upload a folder or a .tar.gz from the dashboard or the API, or deploy from a public Git repository. Nothing is built or executed: the files are served as they are.' },
            { title: 'Preview, then activate', text: 'Check a deploy at its private preview address, then make it live. Activation switches one pointer, so rolling back is one step too.' },
        ],
    }) + sc.features({
        title: 'What works now',
        items: [
            { icon: 'fa-cubes', title: 'Immutable deploys', text: 'Every deploy is content-addressed and kept: files are stored once by their hash, and a deploy never changes after upload.' },
            { icon: 'fa-clock-rotate-left', title: 'Previews and rollback', text: 'A private preview for the project\'s members, one-step activation, and a rollback to the deploy that was live before.' },
            { icon: 'fa-code-branch', title: 'Git deploys', text: 'Point a site at a public repository and branch; each ingest lands as a preview for someone to approve.' },
            { icon: 'fa-globe', title: 'Your own address', text: 'Sites serve under openvibe.website. A custom domain is served once its TXT record proves it is yours.' },
            { icon: 'fa-sliders', title: 'Headers and redirects', text: 'Per-site response headers, redirects and a single-page-app fallback. Platform security headers always win.' },
            { icon: 'fa-users', title: 'Members and roles', text: 'Owners, maintainers and deployers per project; an app can deploy too, with a grant and a role, never as the owner.' },
            { icon: 'fa-shield-halved', title: 'Takedowns kept for review', text: 'OpenVibe staff can stop serving a site or a whole project while its content is kept for review, and lift it again.' },
            { icon: 'fa-terminal', title: 'An API for all of it', text: 'Projects, sites, deploys, domains and configuration over /api/v1, with OpenVibe.Network tokens and space.* capabilities.' },
        ],
    }) + sc.code({
        title: 'The same over the API',
        lede: 'With a Network token for openvibe.space that holds space.deploy.create and a role in the site\'s project.',
        samples: [{ label: 'Upload and activate a build', lang: 'bash', code: `tar -czf site.tar.gz -C dist .
curl -X POST "https://openvibe.space/api/v1/sites/$SITE_ID/deploys?activate=1" \\
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/gzip' \\
  --data-binary @site.tar.gz` }],
    }) + sc.limits({
        title: 'Quotas per project',
        lede: 'What a project may use today; staff can raise a project\'s quota.',
        columns: ['Production', 'Sandbox'],
        rows: [
            row('Storage', 'storageBytes', size),
            row('Deploys per day', 'deploysPerDay'),
            row('Sites', 'sites'),
            row('Custom domains', 'customDomains'),
            row('Files per deploy', 'maxFiles', (n) => n.toLocaleString('en-US')),
            row('Largest file', 'maxFileBytes', size),
        ],
        source: 'https://github.com/OpenVibers/OpenVibe.Space/blob/main/server/hosting-config.js',
    }) + sc.steps({
        title: 'Next',
        items: [
            { title: 'Dynamic pages', text: 'Planned; server side pages are not built yet.' },
            { title: 'Spaces', text: 'Planned; small apps on a person\'s OpenVibe account are not built yet.' },
            { title: 'The forum', href: FORUM_URL, text: 'The forum moved to OpenVibe.Community.' },
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
