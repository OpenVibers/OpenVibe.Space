'use strict';
/**
 * The "not on the list" gate in a real headless Chrome (openvibe-shared 4.123.0's [data-ov-share-gate]):
 * markup only; signed out it offers Sign in, a signed-in stranger is offered Ask for access, and the
 * page has no console error and no CSP refusal. Skipped without Chrome, or with OV_SKIP_BROWSER=1.
 */
const assert = require('assert');
const fs = require('fs');
const { boot, check, done } = require('./helpers/app');

let playwright = null;
try { playwright = require('playwright'); } catch {
    try { playwright = require(process.env.PLAYWRIGHT_MODULE || '/home/workstation/openvibe/work/OpenVibe.Games/node_modules/playwright'); } catch { playwright = null; }
}
const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';
if (process.env.OV_SKIP_BROWSER === '1' || !playwright || !fs.existsSync(CHROME)) {
    console.log('share-gate-chrome: skipped (no Chrome; set CHROME_BIN)');
    process.exit(0);
}
const REFUSED = /Content Security Policy|Refused to (?:load|execute|apply)|Uncaught SyntaxError/i;

(async () => {
    const h = await boot();
    const alice = h.network.addUser({ network_user_id: 21, username: 'alice' });
    const bob = h.network.addUser({ network_user_id: 22, username: 'bob' });
    const sam = h.network.addUser({ network_user_id: 23, username: 'sam' });
    const tok = (u) => h.network.sign({ id: u.network_user_id, subject_id: u.subject_id, username: u.username, display_name: u.display_name, role: 'user', aud: ['openvibe.network', 'openvibe.space'] });
    const spaces = h.app.locals.hosting.spaces;
    const space = await spaces.create({ kind: 'user', subject: alice.subject_id, user: { username: 'alice', display_name: 'alice' } }, { name: 'Secret plan', description: 'SECRET-PLAN', files: [{ path: 'index.html', content: '<h1>SECRET-PLAN</h1>' }] });
    await h.app.locals.hosting.sharing.shares.setAudience(
        { subject: { type: 'user', id: alice.subject_id } }, { service: 'space', kind: 'space', id: space.id }, 'people',
    );
    const url = `${h.base}/spaces/${space.slug}`;

    let browser;
    const errors = [];
    const watch = (p) => {
        p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        p.on('pageerror', (e) => errors.push(String(e)));
    };
    const settled = async (p) => {
        await p.waitForSelector('#share-gate .ov-share-gate', { timeout: 8000 });
        return await p.$eval('#share-gate', (el) => el.textContent.replace(/\s+/g, ' ').trim());
    };

    try {
        await check('headless Chrome: the gate draws itself, signed out, with Sign in', async () => {
            browser = await playwright.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
            const ctx = await browser.newContext();
            const p = await ctx.newPage();
            watch(p);
            const res = await p.goto(url, { waitUntil: 'load', timeout: 15000 });
            assert.strictEqual(res.status(), 404, 'the gate answers 404, never the space');
            const text = await settled(p);
            assert.ok(/Sign in/.test(text), `signed out the gate offers Sign in, got: ${text}`);
            const href = await p.$eval('#share-gate .ov-share-gate a', (a) => a.getAttribute('href'));
            assert.match(href, /^\/auth\/login\?next=/);
            await ctx.close();
        });

        await check('headless Chrome: a stranger is offered Ask for access', async () => {
            const ctx = await browser.newContext();
            await ctx.addCookies([{ name: 'ov_token', value: tok(sam), url: h.base }]);
            const p = await ctx.newPage();
            watch(p);
            await p.goto(url, { waitUntil: 'load', timeout: 15000 });
            const text = await settled(p);
            assert.ok(/Ask for access/.test(text), `a stranger is offered Ask for access, got: ${text}`);
            assert.ok(/@sam/.test(text), 'the gate names the account it is signed in as');
            await ctx.close();
        });

        await check('headless Chrome: no console error and no CSP refusal', async () => {
            assert.deepStrictEqual(errors.filter((e) => REFUSED.test(e)), []);
        });
    } finally {
        if (browser) await browser.close().catch(() => {});
        await h.close();
        done();
    }
})();
