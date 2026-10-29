'use strict';
// The Markdown twins of OpenVibe.Space's public pages (openvibe-shared/agent-layer): the home and
// the update log.
//
// A twin is the page's own render, signed out: the same builder, the same data, no personalisation.
// The home takes no viewer at all and the update log renders the shared update log, so neither can
// carry a person's view. A path with no twin answers 404.
const TWIN_PATH_RE = /^\/(?:updates)?$/;

/** The pages that have a twin (the path, without the query). */
function hasTwin(path) {
    const p = String(path || '/').replace(/\/+$/, '') || '/';
    if (p === '/index') return true;
    return TWIN_PATH_RE.test(p);
}

function createAgentPages({ pages, config }) {
    async function renderPublicPage(path) {
        if (!hasTwin(path)) return null;
        const p = String(path || '/').replace(/\/+$/, '') || '/';
        if (p === '/' || p === '/index') return { html: pages.homePage() };
        if (p === '/updates') return { html: pages.updatesPage({ config }) };
        return null;
    }

    return { renderPublicPage, hasTwin };
}

module.exports = { createAgentPages, hasTwin, TWIN_PATH_RE };
