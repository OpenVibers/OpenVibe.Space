'use strict';
/**
 * OpenVibe.Website's pages (server/website.js serves them at the sites domain itself): the home and its 404.
 *
 * The home shows rather than tells (the owner, 10-31: rooms that open on promises look unfinished). Its hero is the
 * room's motif from openvibe-shared/rooms: a browser frame that assembles a real site, block by block, while the prompt
 * types. Then the five website templates, each a live preview of the real page (an iframe of /templates/<id> with no
 * script), one press from a new space on openvibe.space. It claims nothing Space does not do: publishing at a person's
 * own address waits for public hosting, and the page says so.
 */
const shell = require('openvibe-shared/shell');
const sc = require('openvibe-shared/showcase');
const rooms = require('openvibe-shared/rooms');
const ovServe = require('openvibe-shared/serve');
const appIcon = require('openvibe-shared/app-icon');
const templates = require('../spaces/templates');
const { asset, escapeHtml: esc } = require('./layout');

const SPACE = 'https://openvibe.space';
const NAME = 'OpenVibe.Website';
const DESCRIPTION = 'Websites that look finished from the first preview: start from a real shop, portfolio, event, link page or launch page, or describe yours, and change anything with the preview beside it.';
// No account to start (guest drafts, Space #150): a private edit link, and an OpenVibe account only to keep it.
const startHref = (id) => `${SPACE}/spaces/guest${id ? `?template=${encodeURIComponent(id)}` : '#sp-prompt'}`;

const FAQ = [
    ['Do I need to know how to code?', 'No. Pick a template and change the words, colours and pictures, or describe the site and OpenVibe AI writes a first version. The code is all there when you want it.'],
    ['When can I put it on my own address?', 'Publishing at yourname.openvibe.website or on your own domain opens with public hosting, once the automatic abuse checks, a designated DMCA agent and the domain\'s Public Suffix List entry are in place. Until then you build, edit and preview, and OpenVibe staff publish.'],
    ['Do I need an account?', 'Not to start. Pick a template or describe your site and you get a private link to edit it, good for a week. Sign in with OpenVibe on openvibe.space to keep it; openvibe.website itself keeps no cookies, so no site here can touch your sign-in.'],
    ['Can I take my site somewhere else?', 'Yes. A site is plain HTML, CSS and JavaScript; copy its files out of the editor whenever you like.'],
];

/** The room's motif: the prompt types, then the bakery template's page assembles in its browser, block by block. */
function stage() {
    const block = (cls, i, inner) => `<div class="wb-b ${cls}" style="--i:${i}">${inner}</div>`;
    return `<div class="wb-stage" aria-hidden="true">
<div class="wb-prompt"><span class="wb-spark">✦</span><span class="wb-typed">A bakery site with today's hours</span><span class="wb-caret"></span></div>
<div class="wb-browser">
<div class="wb-bar"><i></i><i></i><i></i><span class="wb-url">rise-and-crumb.openvibe.website</span></div>
<div class="wb-page">
${block('wb-nav', 0, '<b></b><span></span><span></span><span></span>')}
${block('wb-hero', 1, '<div class="wb-copy"><b></b><b class="wb-short"></b><span></span><span class="wb-short"></span><em></em></div><i class="wb-loaf"></i>')}
${block('wb-cards', 2, '<span><b></b><i></i></span><span><b></b><i></i></span><span><b></b><i></i></span>')}
${block('wb-foot', 3, '<span></span>')}
</div>
</div>
<span class="wb-ready">Preview ready</span>
</div>`;
}

/** A template as visitors see it: a small browser window with the real page inside, and the two ways in. */
function templateCard(t, base) {
    return `<article class="wb-tpl" style="--tpl:${esc(t.accent)}">
<a class="wb-win" href="/templates/${esc(t.id)}" aria-label="${esc(t.name)} at full size">
<span class="wb-win-bar"><i></i><i></i><i></i><span>${esc(base.replace(/^https:\/\//, ''))}/templates/${esc(t.id)}</span></span>
<span class="wb-shot"><iframe src="/templates/${esc(t.id)}" title="${esc(t.name)}" loading="lazy" sandbox="" tabindex="-1" aria-hidden="true"></iframe></span>
</a>
<div class="wb-tpl-text"><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p></div>
<div class="wb-tpl-go"><a class="wb-btn" href="${esc(startHref(t.id))}">Use this template</a><a class="wb-link" href="/templates/${esc(t.id)}">Full size</a></div>
</article>`;
}

function home({ base }) {
    const sites = templates.sites();
    const body = `<div class="ov-room wb" style="${rooms.style('website')}">
${sc.hero({
        eyebrow: NAME,
        title: 'Websites that look finished.',
        accent: 'From the first preview.',
        lede: 'Start from a real site (a shop, a portfolio, an event, a link page, a product launch) or describe yours to OpenVibe AI. Change anything in the editor with the preview beside it.',
        actions: [
            { label: 'Pick a template', href: '#templates', primary: true },
            { label: 'Describe your site', href: startHref('') },
        ],
        note: 'No account needed to start: you get a private link to edit your site, and keep it with an OpenVibe account. Publishing at your own address opens with public hosting.',
        aside: { html: stage() },
    })}
<section class="sc-sec" id="templates" aria-labelledby="wb-tpl-h">
<div class="wb-head"><h2 id="wb-tpl-h">Start from a real site</h2><p>${sites.length} whole sites, each one page you can change line by line. Open one full size to see it the way your visitors will.</p></div>
<div class="wb-tpls">${sites.map((t) => templateCard(t, base)).join('')}</div>
</section>
${sc.steps({ id: 'how', title: 'From idea to address', items: [
        { title: 'Pick a site, or describe yours', text: 'A template is a working site from the first second; OpenVibe AI writes a first version from a sentence.' },
        { title: 'Change anything', text: 'Words, colours, sections and code, with the preview beside the editor so every change shows at once.' },
        { title: 'Sign-in and lists built in', text: 'RSVPs, guestbooks and polls keep their lists on OpenVibe, and visitors sign in with their OpenVibe account.' },
        { title: 'Your own address', text: 'yourname.openvibe.website, or your own domain proved by a TXT record. Every publish is kept, so going back is one step.' },
    ] })}
<section class="sc-sec" aria-labelledby="wb-first-h"><div class="wb-first">
<div><h2 id="wb-first-h">Sites made here</h2><p>None public yet: publishing opens with public hosting. Build yours now and it is ready on the first day.</p></div>
<a class="wb-btn" href="#templates">Pick a template</a>
</div></section>
${sc.faq({ id: 'questions', items: FAQ })}
</div>`;
    return page({ base, title: `${NAME} · Websites that look finished`, canonicalPath: '/', body, jsonLd: [
        { '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, url: `${base}/`, description: DESCRIPTION },
        { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ] });
}

function notFound({ base }) {
    return page({ base, title: `Not found · ${NAME}`, canonicalPath: '/', robots: 'noindex', body: `<div class="ov-room wb" style="${rooms.style('website')}">${sc.hero({
        eyebrow: NAME, title: 'Nothing lives at this address.',
        lede: 'Sites people make live at their own name, like rise-and-crumb.openvibe.website. This is OpenVibe.Website\'s front door.',
        actions: [{ label: 'Go to the front door', href: '/', primary: true }],
    })}</div>` });
}

function page({ base, title, canonicalPath, body, jsonLd, robots }) {
    const links = [
        { label: 'Home', href: '/', active: true },
        { label: 'Templates', href: '/#templates' },
        { label: 'Your sites', href: `${SPACE}/spaces/mine` },
    ];
    return shell.page({
        name: NAME, service: 'space', lang: 'en', title, siteName: NAME, description: DESCRIPTION,
        canonical: `${base}${canonicalPath}`, robots: robots || 'index,follow', type: 'website', summary: DESCRIPTION, url: `${base}${canonicalPath}`,
        jsonLd,
        // Nobody is ever signed in on this host (server/website.js): the navbar's sign-in goes to openvibe.space.
        navbar: { service: 'space', apiBase: 'https://openvibe.network', links, sessionUrl: '/auth/me', loginUrl: `${SPACE}/auth/login?next=/spaces/mine` },
        home: '/', navLinks: links.map(({ label, href }) => ({ label, href })),
        footer: { service: 'space', variant: 'auto', path: canonicalPath },
        head: [
            appIcon.headTags({ site: 'space', iconBase: '/assets' }),
            `<link rel="stylesheet" href="${ovServe.url('showcase.css')}">`,
            `<link rel="stylesheet" href="${ovServe.url('room.css')}">`,
            `<link rel="stylesheet" href="${asset('css/space.css')}">`,
            `<link rel="stylesheet" href="${asset('css/website.css')}">`,
        ].join('\n'),
        bodyAttributes: { 'data-page': 'website' },
        body: `<div id="navbar-mount"></div>\n<main id="main" class="page">\n${body}\n</main>`,
    });
}

module.exports = { home, notFound, DESCRIPTION };
