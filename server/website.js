'use strict';
/**
 * OpenVibe.Website's front door at the sites domain itself (plan 5.9; the owner, 2026-10-31: "a bunch of them just
 * redirect and that's it"). http/tenant.js resolves openvibe.website and www.openvibe.website to { kind: 'website' }
 * and this router answers every request to them: the home, the website templates at full size, robots, the sitemap,
 * llms.txt and this site's static files. Anything else is a 404 here; the API, sign-in and the dashboard stay on
 * openvibe.space.
 *
 * No cookie, ever: tenant sites live at <name>.openvibe.website and, until the domain is on the Public Suffix List,
 * a tenant's script could set a cookie for the whole domain. So this host reads none and sets none (nginx strips
 * Cookie and Set-Cookie here as on every tenant host); sign-in and building happen on openvibe.space.
 */
const express = require('express');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const templates = require('./spaces/templates');

const PAGE_CACHE = cache.htmlHeaders({ maxAge: 300 });
// A template at full size is our own page with no script: scripts, frames, forms and plugins are refused, and it is
// never indexed (the home is the page to find).
const TEMPLATE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

function createWebsite({ sitesDomain, publicDir }) {
    const base = `https://${sitesDomain}`;
    const pages = require('./render/website');
    const router = express.Router();

    // www is the same door: one address for search engines and links.
    router.use((req, res, next) => {
        if (String(req.headers.host || '').toLowerCase().startsWith('www.')) return res.redirect(301, `${base}${req.originalUrl}`);
        if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).set('Allow', 'GET, HEAD').type('text/plain').send('Method not allowed');
        return next();
    });

    router.get('/', (_req, res) => res.type('html').set('Cache-Control', PAGE_CACHE).send(pages.home({ base })));

    router.get('/templates/:id', (req, res, next) => {
        const t = templates.get(req.params.id);
        if (!t || t.kind !== 'site') return next();
        res.set({ 'Content-Security-Policy': TEMPLATE_CSP, 'X-Robots-Tag': 'noindex', 'Cache-Control': PAGE_CACHE });
        // The page as it reads with no script: the scripts are left out, not blocked, so nothing complains in a console.
        return res.type('html').send(templates.files(t.id)[0].content.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/gi, ''));
    });

    // The shared navbar's who-is-signed-in read: nobody, always, on this host.
    router.get('/auth/me', (_req, res) => res.set('Cache-Control', 'no-store').json({ user: null }));

    router.get('/robots.txt', (_req, res) => res.type('text/plain').set('Cache-Control', PAGE_CACHE)
        .send(seo.robotsTxt({ sitemaps: [`${base}/sitemap.xml`], disallow: ['/templates/'] })));
    router.get('/sitemap.xml', (_req, res) => res.type('application/xml').set('Cache-Control', PAGE_CACHE)
        .send(seo.sitemapXml([{ loc: `${base}/`, changefreq: 'weekly', priority: 1 }])));
    router.get('/llms.txt', (_req, res) => res.type('text/plain').set('Cache-Control', PAGE_CACHE).send(seo.llmsTxt({
        name: 'OpenVibe.Website',
        summary: pages.DESCRIPTION,
        sections: [
            { title: 'Start', links: [{ title: 'Website templates', url: `${base}/#templates`, html: true }, { title: 'Build on OpenVibe.Space', url: 'https://openvibe.space/spaces/new', html: true }] },
            { title: 'Templates', links: templates.sites().map((t) => ({ title: t.name, url: `${base}/templates/${t.id}`, html: true, note: t.description })) },
        ],
    })));

    router.use('/shared', require('openvibe-shared/serve').handler());
    router.use(express.static(publicDir, { index: false, redirect: false, etag: true }));
    router.use((_req, res) => res.status(404).type('html').set('Cache-Control', PAGE_CACHE).send(pages.notFound({ base })));

    return (req, res, next) => (req.hostTarget === 'website' ? router(req, res, next) : next());
}

module.exports = { createWebsite, TEMPLATE_CSP };
