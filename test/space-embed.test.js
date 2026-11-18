'use strict';
/**
 * Embed a space on any site (plan §AD.15: "a space as an app … embed it on any site"): off until its maker turns it
 * on in Settings; then the published space may be framed by any https page (frame-ancestors 'self' https:), and the
 * editor carries the choice and the snippet's place. Turned off again, only the space itself and openvibe.space may.
 *   node test/space-embed.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');

const ORIGIN = 'https://openvibe.space';

(async () => {
    const t = await boot();
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice'), bob = t.user('bob');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    const body = (r) => JSON.parse(r.text);
    const ancestors = (r) => (/frame-ancestors ([^;]+)/.exec(r.headers['content-security-policy'] || '') || [])[1];
    try {
        let slug, host;
        await check('a published space is framed only by itself and openvibe.space until its maker says otherwise', async () => {
            const r = await form(alice, '/spaces/new', { template: 'poll' });
            slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/publish`)).status, 200);
            host = `${slug}.openvibe.website`;
            const page = await t.get(host, '/');
            assert.strictEqual(page.status, 200);
            assert.strictEqual(ancestors(page), `'self' ${new URL(t.config.baseUrl).origin}`);
            const ed = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
            assert.match(ed.text, /<input type="checkbox" name="embeddable" value="1"> Let any site embed it/);
            assert.match(ed.text, /"embeddable":false/);
        });

        await check('turned on, any https page may frame it; another person cannot turn it on; off again, it is closed', async () => {
            assert.strictEqual((await edit(bob, 'PUT', `/spaces/${slug}/settings`, { embeddable: true })).status, 403, 'another person may see it, never change it');
            const on = await edit(alice, 'PUT', `/spaces/${slug}/settings`, { embeddable: true });
            assert.strictEqual(on.status, 200);
            assert.strictEqual(body(on).space.embeddable, true);
            assert.strictEqual(ancestors(await t.get(host, '/')), "'self' https:");
            const kept = await edit(alice, 'PUT', `/spaces/${slug}/settings`, { name: 'Lunch poll' });
            assert.strictEqual(body(kept).space.embeddable, true, 'a settings save that does not say keeps it');
            assert.strictEqual(body(await edit(alice, 'PUT', `/spaces/${slug}/settings`, { embeddable: false })).space.embeddable, false);
            assert.strictEqual(ancestors(await t.get(host, '/')), `'self' ${new URL(t.config.baseUrl).origin}`);
            assert.strictEqual(body(await edit(alice, 'PUT', `/spaces/${slug}/settings`, { embeddable: 'yes' })).space.embeddable, false, 'only true turns it on');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
