'use strict';
/** Hosting responses do not expose secrets; Space's own auth protects dashboard forms. */
const assert = require('assert');
const { boot, check, done, SECRET } = require('./stageb/boot');
const { tarball } = require('./stageb/tar');
const { csrfToken } = require('../server/auth/forms');

(async () => {
    const t = await boot();
    const alice = t.user('alice');
    let project, site;
    await check('API, pages and events contain no upload or service secrets', async () => {
        const bodies = [];
        const keep = (r) => { bodies.push(r.text); return r; };
        project = keep(await t.api('POST', '/api/v1/projects', { as: alice, json: { name: 'Secrets' } })).json().project;
        site = keep(await t.api('POST', `/api/v1/projects/${project.id}/sites`, { as: alice, json: { name: 'secret-test' } })).json().site;
        const deploy = keep(await t.upload(alice, site.id, { 'index.html': 'hello' })).json().deploy;
        const bad = keep(await t.api('POST', `/api/v1/sites/${site.id}/deploys`, { as: alice, body: tarball([
            { name: 'index.html', content: 'x' }, { name: '.env', content: 'STRIPE_SECRET_KEY=sk_live_TOPSECRET123' },
        ]), headers: { 'content-type': 'application/gzip' } }));
        assert.strictEqual(bad.status, 422);
        for (const route of ['/', '/dashboard', `/projects/${project.id}`, `/sites/${site.id}`, `/deploys/${deploy.id}`, '/api/ready', '/release.json']) {
            keep(await t.api('GET', route, { session: alice }));
        }
        for (const route of [`/api/v1/projects/${project.id}`, `/api/v1/sites/${site.id}`, `/api/v1/deploys/${deploy.id}/log`]) keep(await t.api('GET', route, { as: alice }));
        const all = bodies.join('\n') + JSON.stringify(await t.events());
        for (const needle of [SECRET, 'test-form-secret', 'sk_live_TOPSECRET123', 'STRIPE_SECRET_KEY', 'OV_OAUTH_CLIENT_SECRET', 'SPACE_FORM_SECRET']) assert.ok(!all.includes(needle), needle);
    });
    await check('dashboard forms require Space session, matching origin and CSRF token', async () => {
        const home = await t.api('GET', '/dashboard', { session: alice });
        assert.strictEqual(home.status, 200);
        assert.match(home.text, /Your projects/);
        const csrf = csrfToken(t.config, { subject: alice.subject });
        const action = `/projects/${project.id}/sites`;
        const cross = await t.api('POST', action, { session: alice, form: { csrf, name: 'cross-site' }, headers: { origin: 'https://attacker.example' } });
        assert.strictEqual(cross.status, 403);
        const missing = await t.api('POST', action, { session: alice, form: { name: 'no-token' }, headers: { origin: 'https://openvibe.space' } });
        assert.strictEqual(missing.status, 403);
        const valid = await t.api('POST', action, { session: alice, form: { csrf, name: 'from-form' }, headers: { origin: 'https://openvibe.space' } });
        assert.strictEqual(valid.status, 303);
    });
    await check('hosting API ignores browser cookies', async () => {
        const r = await t.api('GET', '/api/v1/projects', { session: alice });
        assert.strictEqual(r.status, 401);
    });
    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
