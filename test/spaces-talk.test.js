'use strict';
/**
 * Spaces that talk (plan §AD.15: "one space's output feeds another (a price watch feeds a budget)"): a space keeps
 * out.<topic> in its own store, and a space whose events.json listens to space:<slug>/<topic> runs its function with the
 * value. A space hears its own maker's spaces and public ones, never another maker's unlisted space, never itself.
 *   node test/spaces-talk.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');
const { parseEvents, SPACE_ON_RE } = require('../server/spaces/schedules');

const ORIGIN = 'https://openvibe.space';

(async () => {
    await check('events.json may name another space\'s output', () => {
        assert.deepStrictEqual(parseEvents('[{"function":"onprice","on":"space:price-watch-ab12/price"}]').list, [{ fn: 'onprice', on: 'space:price-watch-ab12/price' }]);
        assert.match(parseEvents('[{"function":"x","on":"space:Bad Slug/price"}]').why, /another space's output/);
        assert.ok(!SPACE_ON_RE.test('space:a/b/c') && !SPACE_ON_RE.test('space:../x'));
    });

    const t = await boot();
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice'), bob = t.user('bob');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    const sched = t.ctx.spaceSchedules, data = t.ctx.spaceData;
    const self = (row) => ({ subject: `space:${row.id}`, username: row.slug, name: row.name });
    async function space(u, extra = []) {
        const r = await form(u, '/spaces/new', { template: 'trivia' });
        const slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
        const row = await t.ctx.spaces.getBySlug(slug);
        if (extra.length) {
            const files = (await t.ctx.spaces.files(row)).filter((f) => !f.path.startsWith('functions/'));
            assert.strictEqual((await edit(u, 'PUT', `/spaces/${slug}/files`, { files: [...files, ...extra] })).status, 200);
        }
        assert.strictEqual((await edit(u, 'POST', `/spaces/${slug}/publish`)).status, 200);
        return t.ctx.spaces.getBySlug(slug);
    }
    const listener = (slug) => [
        { path: 'functions/onprice.js', content: 'async function handle(r, ov) { await ov.store.set("heard", { type: r.body.type, from: r.body.event.subject.id, usd: r.body.event.payload.usd }); return "ok"; }' },
        { path: 'events.json', content: JSON.stringify([{ function: 'onprice', on: `space:${slug}/price` }]) },
    ];
    try {
        let watch, budget, other;
        await check('a price watch feeds its maker\'s budget', async () => {
            watch = await space(alice);
            assert.strictEqual((await edit(alice, 'PUT', `/spaces/${watch.slug}/settings`, { visibility: 'unlisted' })).status, 200);
            watch = await t.ctx.spaces.getBySlug(watch.slug);
            budget = await space(alice, listener(watch.slug));
            other = await space(bob, listener(watch.slug));
            await data.kvSet(watch, self(watch), 'out.price', { usd: 12, note: { nested: true } });
            await sched.settle();
            assert.deepStrictEqual(await data.kvGet(budget, self(budget), 'heard'), { type: `space:${watch.slug}/price`, from: watch.slug, usd: 12 });
            assert.strictEqual(await data.kvGet(other, self(other), 'heard'), null, 'another maker never hears an unlisted space');
        });

        await check('a public space is heard by anyone who listens; a space never hears itself; other keys say nothing', async () => {
            assert.strictEqual((await edit(alice, 'PUT', `/spaces/${watch.slug}/settings`, { visibility: 'public' })).status, 200);
            watch = await t.ctx.spaces.getBySlug(watch.slug);
            await data.kvSet(watch, self(watch), 'out.price', { usd: 13 });
            await sched.settle();
            assert.strictEqual((await data.kvGet(other, self(other), 'heard')).usd, 13, 'public: heard');
            const loop = await space(alice, [{ path: 'functions/onprice.js', content: 'async function handle(r, ov) { await ov.store.set("heard", 1); return "ok"; }' }]);
            const files = (await t.ctx.spaces.files(loop)).filter((f) => f.path !== 'events.json');
            await edit(alice, 'PUT', `/spaces/${loop.slug}/files`, { files: [...files, { path: 'events.json', content: JSON.stringify([{ function: 'onprice', on: `space:${loop.slug}/price` }]) }] });
            await edit(alice, 'POST', `/spaces/${loop.slug}/publish`);
            const fresh = await t.ctx.spaces.getBySlug(loop.slug);
            await data.kvSet(fresh, self(fresh), 'out.price', { usd: 1 });
            await sched.settle();
            assert.strictEqual(await data.kvGet(fresh, self(fresh), 'heard'), null, 'never itself');
            assert.strictEqual(sched.tell(watch, 'Bad Topic', 1), 'ignored');
            await data.kvSet(watch, self(watch), 'price', { usd: 99 });
            await sched.settle();
            assert.strictEqual((await data.kvGet(budget, self(budget), 'heard')).usd, 13, 'only out.<topic> says something');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
