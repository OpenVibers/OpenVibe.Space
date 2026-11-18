'use strict';
/**
 * An agent's change can wait for its maker's OK (plan §AD.15: "an agent's edit can wait for approval (a per-space
 * setting)"). Off (the default), the person's agent writes the space's files as before. On, what it writes is kept as a
 * proposal and nothing changes: the editor shows "Waiting for your OK" with what it would add, change and remove; Apply
 * makes it the space's files (a version the agent made, approved); Discard drops it; another person can do neither.
 *   node test/space-agent-review.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');

const ORIGIN = 'https://openvibe.space';
const BUILD_CAPS = ['space.build.read', 'space.build.create', 'space.build.write', 'space.build.publish'];

(async () => {
    const t = await boot();
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice'), bob = t.user('bob');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    const agent = (method, path, person, json) => t.api(method, path, { as: t.network.serviceToken('actor', BUILD_CAPS), json, headers: { 'x-ov-subject': person.subject } });
    const body = (r) => JSON.parse(r.text);
    try {
        let slug, row, original;
        await check('off (the default), the agent writes the files as before', async () => {
            const r = await form(alice, '/spaces/new', { template: 'poll' });
            slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            row = await t.ctx.spaces.getBySlug(slug);
            original = (await t.ctx.spaces.files(row)).map((f) => ({ path: f.path, content: f.content }));
            const w = await agent('PUT', `/api/v1/builder/spaces/${row.id}/files`, alice, { files: [...original, { path: 'a.txt', content: 'one' }] });
            assert.strictEqual(w.status, 200, w.text);
            assert.ok(!body(w).pending);
            assert.ok((await t.ctx.spaces.files(row)).some((f) => f.path === 'a.txt'));
        });

        await check('on, the agent\'s change waits: nothing is written, the editor shows it', async () => {
            const s = await edit(alice, 'PUT', `/spaces/${slug}/settings`, { agent_review: true });
            assert.strictEqual(body(s).space.agent_review, true);
            row = await t.ctx.spaces.getBySlug(slug);
            const before = await t.ctx.spaces.files(row);
            const w = await agent('PUT', `/api/v1/builder/spaces/${row.id}/files`, alice, { files: [...original, { path: 'b.txt', content: 'two' }], note: 'adds a FAQ' });
            assert.strictEqual(w.status, 200, w.text);
            assert.strictEqual(body(w).pending, true);
            assert.deepStrictEqual((await t.ctx.spaces.files(row)).map((f) => f.path).sort(), before.map((f) => f.path).sort(), 'nothing written yet');
            const same = await agent('PUT', `/api/v1/builder/spaces/${row.id}/files`, alice, { files: before.map((f) => ({ path: f.path, content: f.content })) });
            assert.strictEqual(body(same).pending, false, 'no change: nothing to wait for');
            const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
            assert.match(page.text, /<details class="sp-ed-fnlog sp-ed-props" id="ed-proposals" open>/);
            assert.match(page.text, /<small>adds a FAQ<\/small><code>\+ b\.txt  − a\.txt<\/code>/);
            assert.match(page.text, /<input type="checkbox" name="agent_review" value="1"> Its changes wait for my OK/);
        });

        await check('Apply makes it the files (a version the agent made, approved); Discard drops one; nobody else can', async () => {
            const [p] = await t.ctx.spaces.proposals(row);
            assert.strictEqual((await edit(bob, 'POST', `/spaces/${slug}/proposals/${p.id}/apply`)).status, 404, 'another person sees no such space');
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/proposals/999999/apply`)).status, 404);
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/proposals/${p.id}/apply`)).status, 200);
            const now = (await t.ctx.spaces.files(row)).map((f) => f.path);
            assert.ok(now.includes('b.txt') && !now.includes('a.txt'), `the proposal's files (${now})`);
            const v = (await t.ctx.spaces.versions(row))[0];
            assert.deepStrictEqual([v.source, v.note], ['agent', 'approved']);
            assert.deepStrictEqual(await t.ctx.spaces.proposals(row), [], 'applied: no longer waiting');
            await agent('PUT', `/api/v1/builder/spaces/${row.id}/files`, alice, { files: [...original, { path: 'c.txt', content: 'three' }] });
            const [q] = await t.ctx.spaces.proposals(row);
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/proposals/${q.id}/discard`)).status, 200);
            assert.deepStrictEqual(await t.ctx.spaces.proposals(row), []);
            assert.ok(!(await t.ctx.spaces.files(row)).some((f) => f.path === 'c.txt'), 'discarded: never written');
            const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
            assert.doesNotMatch(page.text, /id="ed-proposals"/, 'nothing waiting: no section');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
