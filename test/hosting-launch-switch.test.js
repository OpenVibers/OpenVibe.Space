'use strict';
/** Public hosting remains gated while the engine works for OpenVibe staff. */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');

(async () => {
    const t = await boot({ env: { SPACE_PUBLIC_HOSTING: 'off' } });
    const alice = t.user('alice');
    const staff = t.user('root', { role: 'admin' });
    await check('the public front page explains the tested engine and launch gate', async () => {
        const r = await t.api('GET', '/');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /Immutable, content-addressed deploys with one-step rollback/);
        assert.match(r.text, /OpenVibe staff host here today; it opens to everyone once abuse handling/);
        assert.match(r.text, /designated DMCA agent/);
        assert.doesNotMatch(r.text, /Planned|not built/, 'the home shows what works, never what is planned');
    });
    await check('a person cannot create a project until launch', async () => {
        const r = await t.api('POST', '/api/v1/projects', { as: alice, json: { name: 'Too early' } });
        assert.strictEqual(r.status, 403);
        assert.strictEqual(r.json().code, 'space.not_launched');
    });
    await check('the dashboard explains why the form is unavailable', async () => {
        const r = await t.api('GET', '/dashboard', { session: alice });
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /not open for hosting yet/);
        assert.doesNotMatch(r.text, /<form[^>]+action="\/projects"/);
    });
    await check('staff can create a project', async () => {
        assert.match((await t.project(staff, 'Staff test')).id, /^prj_/);
    });
    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
