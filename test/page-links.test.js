'use strict';
// Every page of openvibe.space gives the shared navbar the site's own page list (the owner, 2026-11-12): the forum
// moved to OpenVibe.Community, so that row is named for where it goes, and the legal pages carry the same list.
const assert = require('assert');
const { boot, check, done } = require('./helpers/app');
const { navbarInit } = require('../server/render/layout');

function initLinks(html) {
    const at = html.indexOf('OpenVibeNavbar.init');
    if (at < 0) return null;
    const start = html.indexOf('links', at);
    const open = html.indexOf('[', start);
    let depth = 0, q = null, esc = false;
    for (let i = open; i < html.length; i += 1) {
        const c = html[i];
        if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '[') depth += 1; else if (c === ']') { depth -= 1; if (!depth) return JSON.parse(html.slice(open, i + 1)); }
    }
    return null;
}

(async () => {
    const t = await boot();
    try {
        const own = navbarInit({ active: 'home' }).links.map(({ label, href }) => ({ label, href }));
        await check('every page sends Space\'s own list, and the forum row names Community', async () => {
            for (const path of ['/', '/spaces', '/dashboard', '/updates', '/terms', '/privacy', '/dmca']) {
                const r = await t.get(path);
                assert.ok([200, 301, 302, 303].includes(r.status), `${path} answered ${r.status}`);
                if (r.status !== 200) continue;
                const links = (initLinks(r.text) || []).map(({ label, href }) => ({ label, href }));
                assert.deepStrictEqual(links, own, `${path} sends Space's list`);
            }
            const forum = own.find((l) => l.href.includes('openvibe.community'));
            assert.ok(forum && forum.label === 'Community', 'the off-site forum is labelled with the site that hosts it');
        });
        await check('every row is a route or a labelled door', async () => {
            for (const { href } of own) {
                if (!href.startsWith('/')) continue;
                const r = await t.get(href);
                assert.notStrictEqual(r.status, 404, `${href} is a route`);
                assert.ok(r.status < 500, `${href} does not fail (${r.status})`);
            }
        });
    } finally { await t.close(); }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
