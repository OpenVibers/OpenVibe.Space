'use strict';
// Space's control API (ADR-048, plan T13 step 10; capability space.resource.control): OpenVibe.Services deletes a site,
// deploy or domain for a person, judged by Space's own project roles exactly as the API's DELETE routes are.
const assert = require('assert');
const crypto = require('crypto');
const { validate } = require('openvibe-contracts');
const { boot, check, done } = require('./stageb/boot');

(async () => {
    const t = await boot();
    try {
        const alice = t.user('alice');
        const dora = t.user('dora');
        const eve = t.user('eve');
        const project = (await t.project(alice, 'Control')).id;
        const other = (await t.project(alice, 'Elsewhere')).id;
        await t.api('PUT', `/api/v1/projects/${project}/members/${dora.subject}`, { as: alice, json: { role: 'deployer' } });
        const services = t.network.serviceToken('services', ['space.resource.control']);
        const ovrn = (type, id, prj = project) => `ovrn:space:${prj}:${type}/${id}`;
        const ask = (type, id, who, extra = {}) => ({ action: 'delete', resource: ovrn(type, id), project_id: project,
            idempotency_key: `k-${crypto.randomUUID()}`, on_behalf_of: { type: 'user', id: who.subject }, ...extra });
        const control = async (body, as = services) => {
            const r = await t.api('POST', '/api/v1/resources/control', { as, json: body });
            return { status: r.status, body: r.text ? r.json() : null, text: r.text };
        };
        const valid = (body) => assert.deepStrictEqual(validate('common.resource-control-result@1', body).errors, [], JSON.stringify(body));
        const domainsOf = async (siteId) => (await t.api('GET', `/api/v1/sites/${siteId}`, { as: alice })).json().domains;

        await check('first-party service tokens with space.resource.control only', async () => {
            const site = await t.site(alice, project, 'rc-gate');
            const body = ask('site', site.id, alice, { dry_run: true });
            assert.strictEqual((await control(body, null)).status, 401);
            assert.strictEqual((await control(body, alice)).status, 403, 'a person holds no service capability');
            assert.strictEqual((await control(body, t.network.serviceToken('services', ['space.resource.read']))).status, 403);
            assert.strictEqual((await control({ action: 'delete' })).status, 400);
            assert.strictEqual((await t.api('GET', `/api/v1/sites/${site.id}`, { as: alice })).status, 200, 'nothing was deleted');
        });

        await check('an owner deletes a site through it: it stops serving, and a repeat replays the answer', async () => {
            const site = await t.site(alice, project, 'rc-site');
            await t.deploy(alice, site.id, { 'index.html': 'hi' });
            const body = ask('site', site.id, alice);
            const first = await control(body);
            assert.strictEqual(first.status, 200, first.text);
            valid(first.body);
            assert.deepStrictEqual([first.body.state, first.body.result.status, first.body.result.changed], ['done', 'deleted', true]);
            assert.strictEqual((await t.api('GET', `/api/v1/sites/${site.id}`, { as: alice })).status, 404, 'the site is gone');
            assert.deepStrictEqual((await control(body)).body, first.body, 'the same key answers the stored result');
            const conflict = await control({ ...body, dry_run: true });
            assert.deepStrictEqual([conflict.status, conflict.body.code], [409, 'control.idempotency_conflict']);
        });

        await check('Space\'s own rules decide: a deployer may not, an outsider is not told it exists, the live deploy and the default domain stay', async () => {
            const site = await t.site(alice, project, 'rc-rules');
            const live = await t.deploy(alice, site.id, { 'index.html': 'v1' });
            const asDeployer = await control(ask('site', site.id, dora));
            valid(asDeployer.body);
            assert.strictEqual(asDeployer.body.state, 'refused', 'deleting needs maintainer or owner');
            assert.notStrictEqual(asDeployer.body.problem.code, 'resources.unknown_resource', 'a member learns why');
            const outsider = await control(ask('site', site.id, eve));
            assert.deepStrictEqual([outsider.body.state, outsider.body.problem.code], ['refused', 'resources.unknown_resource']);
            const liveDeploy = await control(ask('deploy', live.id, alice));
            assert.strictEqual(liveDeploy.body.problem.code, 'deploy.active');
            const dryLive = await control(ask('deploy', live.id, alice, { dry_run: true }));
            assert.strictEqual(dryLive.body.problem.code, 'deploy.active', 'a dry run applies the same rule');
            const older = live;
            await t.deploy(alice, site.id, { 'index.html': 'v2' });
            const gone = await control(ask('deploy', older.id, alice));
            assert.deepStrictEqual([gone.body.state, gone.body.result.status], ['done', 'deleted'], 'a deploy no longer served can go');
            const def = (await domainsOf(site.id)).find((d) => d.kind === 'default');
            assert.strictEqual((await control(ask('domain', def.id, alice))).body.problem.code, 'domain.default');
            const custom = (await t.api('POST', `/api/v1/sites/${site.id}/domains`, { as: alice, json: { hostname: 'rc.example.org' } })).json().domain;
            const dry = await control(ask('domain', custom.id, alice, { dry_run: true }));
            assert.deepStrictEqual([dry.body.state, dry.body.result.dry_run], ['done', true]);
            assert.ok((await domainsOf(site.id)).some((d) => d.id === custom.id), 'a dry run applies nothing');
            assert.strictEqual((await control(ask('domain', custom.id, alice))).body.result.status, 'deleted');
            assert.ok(!(await domainsOf(site.id)).some((d) => d.id === custom.id));
        });

        await check('only delete, only Space\'s kinds, only inside the resource\'s own project', async () => {
            const site = await t.site(alice, other, 'rc-other');
            const elsewhere = await control({ ...ask('site', site.id, alice), resource: ovrn('site', site.id, project) });
            assert.strictEqual(elsewhere.body.problem.code, 'resources.unknown_resource', 'a site of another project is not found here');
            const own = await t.site(alice, project, 'rc-kinds');
            const suspend = await control({ ...ask('site', own.id, alice), action: 'suspend' });
            valid(suspend.body);
            assert.strictEqual(suspend.body.problem.code, 'control.unsupported_action');
            const media = await control({ ...ask('site', own.id, alice), resource: `ovrn:media:${project}:object/med_${'0'.repeat(26)}` });
            assert.strictEqual(media.body.problem.code, 'resources.unknown_resource');
            assert.strictEqual((await t.api('GET', `/api/v1/sites/${own.id}`, { as: alice })).status, 200);
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
