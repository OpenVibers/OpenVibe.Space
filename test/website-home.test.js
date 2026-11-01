'use strict';
/**
 * OpenVibe.Website's front door (server/website.js; the owner, 2026-10-31: the domain only redirected). The sites
 * domain itself answers with its own home, never a tenant and never the dashboard: the motif, the website templates
 * with live previews of the real pages, one press from a new space on openvibe.space. The host reads and sets no
 * cookie, serves nothing of the API or sign-in, and a template at full size runs no script.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot, check, done } = require('./stageb/boot');
const templates = require('../server/spaces/templates');

const src = fs.readFileSync(path.join(__dirname, '..', 'server/website.js'), 'utf8');
// The host dispatch: the sites domain and www are the front door, before any tenant lookup, and pass on to the app.
const tenantSrc = fs.readFileSync(path.join(__dirname, '..', 'server/http/tenant.js'), 'utf8');
const hostingSrc = fs.readFileSync(path.join(__dirname, '..', 'server/hosting.js'), 'utf8');
assert.ok(tenantSrc.indexOf("return { kind: 'website', host }") > 0 && tenantSrc.indexOf("return { kind: 'website', host }") < tenantSrc.indexOf('if (host.endsWith(suffix))'), 'the apex is resolved before any tenant');
assert.match(hostingSrc, /target\.kind === 'dashboard' \|\| target\.kind === 'website'\) return next\(\)/, 'the front door goes on to the app, not to a tenant');

(async () => {
    const t = await boot();
    const alice = t.user('alice');
    try {
        await check('the sites domain is the front door: the motif, every website template, the honest status', async () => {
            const r = await t.get('openvibe.website', '/');
            assert.strictEqual(r.status, 200, r.text.slice(0, 300));
            assert.match(r.headers['content-type'], /text\/html/);
            assert.ok(r.text.includes('class="wb-stage"') && r.text.includes('class="wb-typed"'), 'the prompt types and the page assembles');
            const sites = templates.sites();
            assert.strictEqual(sites.length, 5, 'five website templates');
            for (const s of sites) {
                assert.ok(r.text.includes(`<iframe src="/templates/${s.id}"`) && r.text.includes('sandbox=""'), `${s.id} previews with no script`);
                assert.ok(r.text.includes(`https://openvibe.space/spaces/guest?template=${s.id}`), `${s.id} starts a draft with no account`);
            }
            assert.match(r.text, /Publishing at your own address opens with public hosting/, 'it claims no publishing it does not have');
            assert.match(r.text, /No account needed to start/, 'and says what is true now: no account to start');
            assert.match(r.text, /<link rel="canonical" href="https:\/\/openvibe\.website\/">/);
            assert.strictEqual((r.text.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
            assert.ok(r.text.includes('"@type":"FAQPage"'), 'its questions are structured data');
        });

        await check('no cookie, ever: none set, none read, no sign-in or API on this host', async () => {
            const home = await t.get('openvibe.website', '/', { headers: { cookie: 'ov_token=x; sp_sess=y' } });
            assert.strictEqual(home.headers['set-cookie'], undefined, 'the home sets no cookie');
            for (const p of ['/auth/login', '/api/v1/projects', '/dashboard', '/spaces/new', '/updates']) {
                const r = await t.get('openvibe.website', p);
                assert.strictEqual(r.status, 404, `${p} is not served here`);
                assert.strictEqual(r.headers['set-cookie'], undefined, `${p} sets no cookie`);
            }
            const me = await t.get('openvibe.website', '/auth/me', { session: alice });
            assert.deepStrictEqual(me.json(), { user: null }, 'nobody is signed in here, even with a session cookie');
            const post = await t.request({ method: 'POST', host: 'openvibe.website', path: '/', body: 'x=1' });
            assert.strictEqual(post.status, 405);
            assert.ok(!/cookieParser|createAuthRoutes|req\.cookies/.test(src), 'the router never touches cookies');
        });

        await check('a template at full size is the real page with no script, never indexed', async () => {
            const r = await t.get('openvibe.website', '/templates/site-bakery');
            assert.strictEqual(r.status, 200);
            assert.match(r.text, /Rise &amp; Crumb/);
            assert.match(r.headers['content-security-policy'], /default-src 'none'/);
            assert.ok(!/script-src/.test(r.headers['content-security-policy']), 'no script source at all');
            assert.strictEqual(r.headers['x-robots-tag'], 'noindex');
            assert.ok(!/<script/i.test(r.text), 'its scripts are left out, not blocked');
            assert.strictEqual((await t.get('openvibe.website', '/templates/poll')).status, 404, 'an app template is not a website');
            assert.strictEqual((await t.get('openvibe.website', '/templates/..%2fpoll')).status, 404);
        });

        await check('www is the same door (and no one can name a site www)', async () => {
            const r = await t.get('www.openvibe.website', '/templates/site-event?x=1');
            assert.strictEqual(r.status, 301);
            assert.strictEqual(r.headers.location, 'https://openvibe.website/templates/site-event?x=1');
        });

        await check('robots, the sitemap and llms.txt speak for this host', async () => {
            assert.match((await t.get('openvibe.website', '/robots.txt')).text, /Sitemap: https:\/\/openvibe\.website\/sitemap\.xml/);
            assert.match((await t.get('openvibe.website', '/sitemap.xml')).text, /<loc>https:\/\/openvibe\.website\/<\/loc>/);
            const llms = (await t.get('openvibe.website', '/llms.txt')).text;
            assert.match(llms, /^# OpenVibe\.Website/);
            for (const s of templates.sites()) assert.ok(llms.includes(`https://openvibe.website/templates/${s.id}`), s.id);
        });

        await check('the guest start page leads with a website template picked on the front door', async () => {
            const r = await t.request({ method: 'GET', host: 'openvibe.space', path: '/spaces/guest?template=site-event' });
            assert.strictEqual(r.status, 200, r.text.slice(0, 200));
            assert.match(r.text, /<section class="sp-pick"[^>]*>[\s\S]*?<h2 id="sp-pick-h">Event page<\/h2>[\s\S]*?name="template" value="site-event"/);
            const app = await t.request({ method: 'GET', host: 'openvibe.space', path: '/spaces/guest?template=poll' });
            assert.ok(!app.text.includes('class="sp-pick"'), 'an app template is not a website to start from here');
        });

        await check('openvibe.space leads with a template picked on the front door', async () => {
            const r = await t.request({ method: 'GET', host: 'openvibe.space', path: '/spaces/new?template=site-portfolio', session: alice });
            assert.strictEqual(r.status, 200, r.text.slice(0, 200));
            assert.match(r.text, /<section class="sp-pick"[^>]*>[\s\S]*?<h2 id="sp-pick-h">Portfolio<\/h2>[\s\S]*?name="template" value="site-portfolio"/);
            const plain = await t.request({ method: 'GET', host: 'openvibe.space', path: '/spaces/new?template=nope', session: alice });
            assert.ok(!plain.text.includes('class="sp-pick"'), 'an unknown template picks nothing');
        });

        await check('a description handed over from Codes fills the box, one press from a build', async () => {
            const said = 'A snake game <b>with</b> a leaderboard & sound';
            const r = await t.request({ method: 'GET', host: 'openvibe.space', path: `/spaces/new?prompt=${encodeURIComponent(said)}&from=codes`, session: alice });
            assert.strictEqual(r.status, 200, r.text.slice(0, 200));
            assert.ok(r.text.includes('A snake game &lt;b&gt;with&lt;/b&gt; a leaderboard &amp; sound</textarea>'), 'the description fills the box, escaped');
            assert.ok(!r.text.includes('<b>with</b>'), 'nothing in it is markup');
            assert.match(r.text, /class="sp-handover"[^>]*>[\s\S]*?From OpenVibe Codes/);
            assert.match(r.text, /<button class="sp-btn"[^>]*autofocus[^>]*>[\s\S]*?Build it/, 'Build it takes the focus');
            const plain = await t.request({ method: 'GET', host: 'openvibe.space', path: `/spaces/new?prompt=${encodeURIComponent(said)}`, session: alice });
            assert.ok(plain.text.includes('a leaderboard &amp; sound</textarea>') && !plain.text.includes('class="sp-handover"'), 'a prompt from anywhere else fills the box without the Codes line');
            const picked = await t.request({ method: 'GET', host: 'openvibe.space', path: `/spaces/new?template=site-portfolio&prompt=${encodeURIComponent(said)}`, session: alice });
            assert.ok(!picked.text.includes('a leaderboard &amp; sound'), 'a picked template leads, and the box stays empty');
        });

        await check('the guest start page takes a handed-over description too, and a gated page never echoes it', async () => {
            const r = await t.request({ method: 'GET', host: 'openvibe.space', path: `/spaces/guest?prompt=${encodeURIComponent('A bakery site with our hours')}&from=codes` });
            assert.strictEqual(r.status, 200, r.text.slice(0, 200));
            assert.ok(r.text.includes('A bakery site with our hours</textarea>'));
            assert.match(r.text, /class="sp-handover"/);
            const gated = await t.request({ method: 'GET', host: 'openvibe.space', path: `/spaces/new?prompt=${encodeURIComponent('secret plan for a site')}&from=codes` });
            assert.strictEqual(gated.status, 401);
            assert.ok(!gated.text.includes('secret plan'), 'an anonymous answer carries nothing from the query');
        });
    } finally { await t.close(); }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
