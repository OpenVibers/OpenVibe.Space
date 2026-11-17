'use strict';
/**
 * A published space installs as an app (plan §AD.15: "install it on a phone (PWA)"): it serves its own web app
 * manifest (name, home, standalone, colour) and icons (an SVG, and PNGs at 192 and 512), and the space SDK links the
 * manifest on a page that has none; the editor's preview does not. Other /_openvibe/ paths are not served.
 *   node test/space-app.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');
const { sdkSource } = require('../server/spaces/sdk');
const app = require('../server/spaces/app-manifest');

const ORIGIN = 'https://openvibe.space';

(async () => {
    await check('the manifest and icon come from the space: its name, its hue, its first letter', () => {
        const sp = { id: 'spc_1', name: 'Ember Watch', slug: 'ember-watch', description: 'Who is live' };
        const m = app.manifest(sp);
        assert.deepStrictEqual([m.name, m.start_url, m.scope, m.display], ['Ember Watch', '/', '/', 'standalone']);
        assert.deepStrictEqual(m.icons.map((i) => i.sizes), ['192x192', '512x512', 'any']);
        assert.strictEqual(app.initialOf('  9 lives'), '9');
        assert.strictEqual(app.initialOf('éclair'), 'É');
        assert.match(app.iconSvg({ id: 'x', name: '<b>' }), />B<\/text>/, 'only a letter or digit reaches the icon (markup never does)');
        assert.strictEqual(app.iconPng(sp, 192).slice(1, 4).toString(), 'PNG');
        assert.strictEqual(app.iconPng(sp, 300), null, 'only the install sizes');
        assert.match(sdkSource({ mode: 'live', space: sp }), /link\[rel="manifest"\][\s\S]*\/_openvibe\/manifest\.webmanifest/);
        assert.match(sdkSource({ mode: 'live', space: sp }), /CFG\.mode !== 'preview'/, 'never in the preview frame');
    });

    const t = await boot();
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    try {
        await check('a published space serves its manifest and icons; other /_openvibe/ paths are not served', async () => {
            const r = await form(alice, '/spaces/new', { template: 'poll' });
            const slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/publish`)).status, 200);
            const host = `${slug}.openvibe.website`;
            const man = await t.get(host, '/_openvibe/manifest.webmanifest');
            assert.strictEqual(man.status, 200);
            assert.match(man.headers['content-type'] || man.headers.get?.('content-type') || '', /application\/manifest\+json/);
            const j = JSON.parse(man.text);
            assert.strictEqual(j.display, 'standalone');
            const png = await t.get(host, '/_openvibe/icon-512.png');
            assert.strictEqual(png.status, 200);
            assert.strictEqual((await t.get(host, '/_openvibe/icon.svg')).status, 200);
            assert.notStrictEqual((await t.get(host, '/_openvibe/secret.txt')).status, 200, 'nothing else under /_openvibe/');
            assert.strictEqual((await t.get(host, '/_openvibe/sdk.js')).status, 200, 'the SDK still answers');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
