'use strict';
const kit = require('openvibe-shared/kit');
const sectionIcon = (name) => kit.icon(name, { cls: 'ovk-heading-icon' });
// A template's glyph, in the ring icon the shared showcase draws (it only knows Font Awesome names otherwise).
const RING = { 'book-open': 'docs', robot: 'bot', chart: 'report', zap: 'live', help: 'help', steps: 'quest', store: 'trade', pencil: 'design', calendar: 'calendar', link: 'link', rocket: 'space', file: 'docs' };

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
const { pickBlock, foldBlock } = require('./short');

const FORUM_URL = `${config.communityUrl}/forum`;
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

/**
 * The home's picture: a sentence in, an app out. The request a person types ("A sign-up sheet for our game night"),
 * and under it the space that comes back, as a small window: its address, a title, the list people add themselves
 * to, and its one button. Plain markup and CSS (public/css/space.css, .sp-scene): the window rises in and its rows
 * arrive once, and everything is simply in place under reduced motion. The words in it are an example, and the caption
 * says so.
 */
function spaceScene() {
    return `<figure class="sp-scene" aria-label="An example: a request, and the space it becomes">
<p class="sp-scene-ask"><span>You ask</span><b>A sign-up sheet for our game night</b></p>
<div class="sp-scene-win">
<p class="sp-scene-bar"><i></i><i></i><i></i><span>game-night.openvibe.space</span></p>
<div class="sp-scene-app"><b>Game night, Friday</b>
<ul><li><span class="sp-scene-av" style="--h:200">M</span>maru<em>bringing snacks</em></li><li><span class="sp-scene-av" style="--h:120">K</span>kiwi<em>two guests</em></li><li><span class="sp-scene-av" style="--h:320">T</span>teddy</li></ul>
<span class="sp-scene-btn">Add my name</span></div></div>
<figcaption>An example: one sentence in, a space people can sign in to and use.</figcaption></figure>`;
}

/** Hosting is working for staff; dynamic pages and spaces are the next stage. */
function homePage() {
    const q = defaultQuotas();
    const row = (label, key, fmt = String) => ({ label, values: [fmt(q.production[key]), fmt(q.sandbox[key])] });
    // The home's six parts, one at a time on a phone (the owner's short-pages rule, 2026-10-30): the chips pick one of
    // them and every part stays in the page for crawlers. The id of a part is the one the page already links to.
    const parts = [
        { id: 'templates', label: 'Templates', html: sc.features({
            title: 'Start from a template',
            lede: 'Each one is a working space you can open in the editor and change: sign-in, data and AI already wired.',
            items: TEMPLATES.filter((t) => t.id !== 'blank').map((t) => ({ icon: `ov:${RING[t.icon] || 'space'}`, title: t.name, text: t.description, href: '/spaces/new' })),
        }) },
        { id: 'make', label: 'Making one', html: sc.steps({
            title: 'How a space comes together',
            items: [
                { title: 'Describe it, or pick a template', text: 'Say what the app should do and OpenVibe AI writes a first version, or open a template.', href: '/spaces/new' },
                { title: 'Change anything', text: 'The editor shows your space\'s files with a sandboxed preview beside them, so every change is visible at once.' },
                { title: 'Sign-in, data and AI built in', text: 'The space SDK gives you the visitor\'s OpenVibe profile, shared lists, private storage, OpenVibe AI and server functions.' },
                { title: 'Share it', text: 'People open it with their OpenVibe account; publishing at its own address opens with public hosting.' },
            ],
        }) },
        { id: 'how', label: 'Deploys', html: sc.steps({
            title: 'How a deploy works',
            items: [
                { title: 'Make a project and a site', text: 'A project holds sites and the people who may change them. Each site gets its own address under openvibe.website.' },
                { title: 'Upload, or connect Git', text: 'Upload a folder or a .tar.gz from the dashboard or the API, or deploy from a public Git repository. Nothing is built or executed: the files are served as they are.' },
                { title: 'Preview, then activate', text: 'Check a deploy at its private preview address, then make it live. Activation switches one pointer, so rolling back is one step too.' },
            ],
        }) },
        { id: 'now', label: 'What works', html: sc.features({
            title: 'What works now',
            items: [
                { icon: 'ov:space', title: 'Immutable deploys', text: 'Every deploy is content-addressed and kept: files are stored once by their hash, and a deploy never changes after upload.' },
                { icon: 'ov:history', title: 'Previews and rollback', text: 'A private preview for the project\'s members, one-step activation, and a rollback to the deploy that was live before.' },
                { icon: 'ov:git', title: 'Git deploys', text: 'Point a site at a public repository and branch; each ingest lands as a preview for someone to approve.' },
                { icon: 'ov:website', title: 'Your own address', text: 'Sites serve under openvibe.website. A custom domain is served once its TXT record proves it is yours.' },
                { icon: 'ov:theme', title: 'Headers and redirects', text: 'Per-site response headers, redirects and a single-page-app fallback. Platform security headers always win.' },
                { icon: 'ov:community', title: 'Members and roles', text: 'Owners, maintainers and deployers per project; an app can deploy too, with a grant and a role, never as the owner.' },
                { icon: 'ov:shield', title: 'Takedowns kept for review', text: 'OpenVibe staff can stop serving a site or a whole project while its content is kept for review, and lift it again.' },
                { icon: 'ov:code', title: 'An API for all of it', text: 'Projects, sites, deploys, domains and configuration over /api/v1, with OpenVibe.Network tokens and space.* capabilities.' },
            ],
        }) },
        { id: 'api', label: 'The API', html: sc.code({
            title: 'The same over the API',
            lede: 'With a Network token for openvibe.space that holds space.deploy.create and a role in the site\'s project.',
            samples: [{ label: 'Upload and activate a build', lang: 'bash', code: `tar -czf site.tar.gz -C dist .
curl -X POST "https://openvibe.space/api/v1/sites/$SITE_ID/deploys?activate=1" \\
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/gzip' \\
  --data-binary @site.tar.gz` }],
        }) },
        { id: 'quotas', label: 'Quotas', html: sc.limits({
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
        }) },
    ];
    const body = sc.hero({ pageHead: { icon: 'home' },
        eyebrow: 'OpenVibe.Space · spaces',
        title: 'Make a space.',
        // The hero's picture is what Space does, drawn (2026-11-10; the owner: no more "generic circled" homes): what
        // a person asks for, and the small app that comes back at its own address. An example, and it says so.
        aside: { html: spaceScene() },
        accent: 'An app on your OpenVibe account.',
        lede: 'Describe what you want and OpenVibe AI builds it, or start from a template and change anything in the editor. A space signs visitors in with OpenVibe, keeps shared lists and private data, and talks to OpenVibe AI.',
        actions: [
            { label: 'Make a space', href: '/spaces/new', primary: true, icon: 'ov:ai' },
            { label: 'Browse spaces', href: '/spaces', icon: 'ov:space' },
        ],
        note: 'The builder, the editor and the preview work for everyone signed in. Publishing a space at its own address opens with public hosting.',
    }) + pickBlock({ key: 'parts', label: 'What Space does', head: 'What Space does', panes: parts })
    + sc.cta({
        title: 'Static hosting: publish a site, keep every deploy.',
        text: 'Immutable, content-addressed deploys with one-step rollback, previews, Git deploys and verified custom domains. OpenVibe staff host here today; it opens to everyone once abuse handling and a designated DMCA agent are in place.',
        actions: [
            { label: 'Hosting dashboard', href: '/dashboard', primary: true },
            { label: 'How it works', href: '#how' },
        ],
    }) + foldBlock({
        id: 'questions',
        head: `<h2 id="space-faq-h" class="ovk-titled">${sectionIcon('help')}Questions</h2>`,
        html: `<section class="sc-sec" id="questions" aria-labelledby="space-faq-h"><h2 class="ovk-titled">${sectionIcon('help')}Questions</h2>${HOME_FAQ.map((f) => `<details class="space-faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</section>`,
    }) + sc.cta({
        title: 'Looking for the forum?',
        text: 'The forum moved to OpenVibe.Community.',
        actions: [{ label: 'Open the forum', href: FORUM_URL, primary: true }],
    });
    const site = String(config.publicUrl || config.baseUrl || 'https://openvibe.space').replace(/\/+$/, '');
    return renderPage({
        canonicalPath: '/', active: 'home', styles: ['kit.css', sc.STYLESHEET], body, description: HOME_DESCRIPTION,
        agentLayer: true, llms: '/llms.txt',
        // The rule that shows the picked part of the home's pick block: one per part, written for this page.
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
  ${kit.pageHead({ title: `${title}`, icon: 'home', back: { href: '/', label: 'Home' } })}
  ${message ? `<p class="lede">${esc(message)}</p>` : ''}
  ${links ? `<p><a class="btn" href="/">Home</a> <a class="btn" href="${esc(FORUM_URL)}">The forum</a></p>` : ''}
</section>`;
    return renderPage({ title, description: message || title, canonicalPath: '/', robots: 'noindex,nofollow', footerVariant: 'compact', body });
}

/**
 * The update log (/updates): the shared update log every OpenVibe site has. The agent layer's twin renders
 * the same page, signed out (no viewer), so the two cannot drift.
 */
function updatesPage({ config, viewer = null } = {}) {
    const frame = require('openvibe-shared/frame');
    const body = frame.updatesBody({ service: 'space', siteName: 'OpenVibe.Space' })
        + `<script src="${require('openvibe-shared/serve').url('shipped.js')}" defer></script>`;
    return renderPage({
        title: 'What shipped on OpenVibe.Space',
        description: 'Every change deployed to OpenVibe.Space, newest first, from the OpenVibe network\'s shared update log.',
        canonicalPath: '/updates', body, viewer, config, path: '/updates', indexable: true,
        agentLayer: true, llms: '/llms.txt',
    });
}

module.exports = { homePage, updatesPage, errorPage };
