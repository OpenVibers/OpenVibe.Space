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
const TEMPLATES = require('../spaces/templates').list();

const HOME_DESCRIPTION = 'Make an app on your OpenVibe account: describe it and OpenVibe AI builds it, or start from a template. Sign-in, shared data and AI are built in.';
/** The home's questions: shown on the page and given to search engines as FAQPage data (the same text). */
const HOME_FAQ = [
    { q: 'What is a space?', a: 'A small app on your OpenVibe account: a page with your own code that signs visitors in with OpenVibe, keeps shared lists and each visitor\'s private data, can call OpenVibe AI, and can run server functions.' },
    { q: 'Do I need to know how to code?', a: 'No. Describe what you want and OpenVibe AI builds a first version, or start from a template. Everything is editable in the editor, with a live preview beside it.' },
    { q: 'Who can use a space I make?', a: 'Anyone you share it with signs in with their OpenVibe account. Each visitor\'s private data is theirs; shared lists are what everyone in the space sees.' },
    { q: 'Can I publish a space at its own address?', a: 'Publishing at its own address opens with public hosting, once abuse handling and a designated DMCA agent are in place. The builder, the editor and the preview work for everyone signed in today.' },
    { q: 'What is static hosting?', a: 'Immutable deploys of a built site with previews, one-step rollback, Git deploys and verified custom domains under openvibe.website. OpenVibe staff host on it today; it opens to everyone with public hosting.' },
    { q: 'Where did the forum go?', a: 'The forum moved to OpenVibe.Community; old links redirect there.' },
];

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
        eyebrow: 'OpenVibe.Space · spaces',
        title: 'Make a space.',
        accent: 'An app on your OpenVibe account.',
        lede: 'Describe what you want and OpenVibe AI builds it, or start from a template and change anything in the editor. A space signs visitors in with OpenVibe, keeps shared lists and private data, and talks to OpenVibe AI.',
        actions: [
            { label: 'Make a space', href: '/spaces/new', primary: true, icon: 'fa-wand-magic-sparkles' },
            { label: 'Browse spaces', href: '/spaces', icon: 'fa-shapes' },
        ],
        note: 'The builder, the editor and the preview work for everyone signed in. Publishing a space at its own address opens with public hosting.',
    }) + sc.features({
        id: 'templates',
        title: 'Start from a template',
        lede: 'Each one is a working space you can open in the editor and change: sign-in, data and AI already wired.',
        items: TEMPLATES.filter((t) => t.id !== 'blank').map((t) => ({ icon: t.icon, title: t.name, text: t.description, href: '/spaces/new' })),
    }) + sc.steps({
        title: 'How a space comes together',
        items: [
            { title: 'Describe it, or pick a template', text: 'Say what the app should do and OpenVibe AI writes a first version, or open a template.', href: '/spaces/new' },
            { title: 'Change anything', text: 'The editor shows your space\'s files with a sandboxed preview beside them, so every change is visible at once.' },
            { title: 'Sign-in, data and AI built in', text: 'The space SDK gives you the visitor\'s OpenVibe profile, shared lists, private storage, OpenVibe AI and server functions.' },
            { title: 'Share it', text: 'People open it with their OpenVibe account; publishing at its own address opens with public hosting.' },
        ],
    }) + sc.cta({
        title: 'Static hosting: publish a site, keep every deploy.',
        text: 'Immutable, content-addressed deploys with one-step rollback, previews, Git deploys and verified custom domains. OpenVibe staff host here today; it opens to everyone once abuse handling and a designated DMCA agent are in place.',
        actions: [
            { label: 'Hosting dashboard', href: '/dashboard', primary: true },
            { label: 'How it works', href: '#how' },
        ],
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
    }) + `<section class="sc-sec" id="questions" aria-labelledby="space-faq-h"><h2 id="space-faq-h">Questions</h2>${HOME_FAQ.map((f) => `<details class="space-faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</section>` + sc.cta({
        title: 'Looking for the forum?',
        text: 'The forum moved to OpenVibe.Community.',
        actions: [{ label: 'Open the forum', href: FORUM_URL, primary: true }],
    });
    const site = String(config.publicUrl || config.baseUrl || 'https://openvibe.space').replace(/\/+$/, '');
    return renderPage({
        canonicalPath: '/', active: 'home', styles: [sc.STYLESHEET], body, description: HOME_DESCRIPTION,
        jsonLd: [
            { '@context': 'https://schema.org', '@type': 'WebSite', name: 'OpenVibe.Space', url: `${site}/`, description: HOME_DESCRIPTION },
            { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: HOME_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
        ],
    });
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
