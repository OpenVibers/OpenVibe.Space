'use strict';
/**
 * Spaces that keep working (plan §AD.15): a published space's schedules.json runs its functions/<name>.js on a clock,
 * as the space itself (no visitor; POST with x-ov-trigger: schedule), one at a time; each run's outcome is kept for
 * the editor; what is not due waits; a draft or an unpublished change never runs; a bad schedule says what is wrong.
 *   node test/space-schedules.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');
const { parseSchedules, everySeconds } = require('../server/spaces/schedules');

const ORIGIN = 'https://openvibe.space';

(async () => {
    await check('the clock: 15 minutes to 7 days, named functions, at most five', () => {
        assert.deepStrictEqual([everySeconds('15m'), everySeconds('2h'), everySeconds('1d'), everySeconds('5m'), everySeconds('8d'), everySeconds('soon')], [900, 7200, 86400, null, null, null]);
        assert.deepStrictEqual(parseSchedules('[{"function":"tick","every":"1h"}]'), { list: [{ fn: 'tick', every: 3600 }], why: null });
        assert.match(parseSchedules('{"function":"tick"}').why, /a list/);
        assert.match(parseSchedules('[{"function":"../x","every":"1h"}]').why, /not a function name/);
        assert.match(parseSchedules('[{"function":"tick","every":"1m"}]').why, /15m to 7d/);
        assert.strictEqual(parseSchedules(JSON.stringify(Array.from({ length: 7 }, (_, i) => ({ function: `f${i}`, every: '1h' })))).list.length, 5);
        assert.match(parseSchedules('not json').why, /not valid JSON/);
    });

    const t = await boot();
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    const sched = t.ctx.spaceSchedules;
    try {
        let slug, row, siteId;
        await check('a published space\'s schedule runs its function as the space, on the clock, and says how it went', async () => {
            const r = await form(alice, '/spaces/new', { template: 'trivia' });
            slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            row = await t.ctx.spaces.getBySlug(slug);
            const files = (await t.ctx.spaces.files(row)).filter((f) => !f.path.startsWith('functions/'));
            const save = await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: [...files,
                { path: 'functions/tick.js', content: 'async function handle(r, ov) { const n = (await ov.store.get("n")) || 0; await ov.store.set("n", n + 1); await ov.store.set("last", { m: r.method, t: r.headers["x-ov-trigger"], who: ov.user }); return { n: n + 1 }; }' },
                { path: 'functions/broken.js', content: 'function handle() { throw new Error("nope"); }' },
                { path: 'schedules.json', content: JSON.stringify([{ function: 'tick', every: '15m' }, { function: 'broken', every: '1h' }, { function: 'missing', every: '1h' }]) },
            ] });
            assert.ok([200, 204].includes(save.status), `saved (${save.status} ${save.text && save.text.slice(0, 120)})`);
            // A draft never runs.
            assert.deepStrictEqual(await sched.tick(), { ran: 0 }, 'a draft has no schedule');
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/publish`)).status, 200);
            const site = await t.ctx.store.db.prepare("SELECT s.id FROM space_sites s WHERE s.status = 'active' AND s.active_deploy_id IS NOT NULL ORDER BY s.created_at DESC LIMIT 1").get();
            siteId = site.id;
            assert.deepStrictEqual(await sched.tick(), { ran: 3 }, 'published: all three are due');
            const runs = Object.fromEntries((await sched.status(siteId)).map((x) => [x.function, x]));
            assert.strictEqual(runs.tick.last_status, 'ok');
            assert.strictEqual(runs.tick.runs, 1);
            assert.strictEqual(runs.broken.last_status, 'error');
            assert.match(runs.broken.last_error, /^500: functions\/broken\.js failed: .*nope/);
            assert.strictEqual(runs.missing.last_status, 'error');
            assert.match(runs.missing.last_error, /there is no functions\/missing\.js/);
            const kv = await t.ctx.spaceData.kvGet(row, null, 'last').catch(() => null);
            if (kv) assert.deepStrictEqual(kv, { m: 'POST', t: 'schedule', who: null }, 'as the space itself, marked as the schedule');
        });

        await check('what is not due waits; when its time comes it runs again', async () => {
            assert.deepStrictEqual(await sched.tick(), { ran: 0 }, 'nothing is due a moment later');
            t.clock.advance(16 * 60 * 1000);
            assert.deepStrictEqual(await sched.tick(), { ran: 1 }, 'after 16 minutes, the 15-minute one');
            const runs = Object.fromEntries((await sched.status(siteId)).map((x) => [x.function, x]));
            assert.strictEqual(runs.tick.runs, 2);
            assert.strictEqual(runs.broken.runs, 1, 'the hourly ones wait');
        });

        await check('the job is off outside production unless asked, and in a drill', () => {
            assert.strictEqual(sched.enabled, false, 'tests and drills: the clock does not start by itself');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
