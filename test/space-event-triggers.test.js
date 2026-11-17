'use strict';
/**
 * Spaces that react (plan §AD.15: "an event from any OpenVibe site (a stream started …)"): a published space's
 * events.json names public event types; when OpenVibe.Events delivers one, its function runs as the space with the
 * event (its plain public values only). A type that is not public is never subscribed or dispatched; a draft never runs.
 *   node test/space-event-triggers.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');
const { parseEvents, publicPayload, EVENT_TYPES } = require('../server/spaces/schedules');

const ORIGIN = 'https://openvibe.space';

(async () => {
    await check('events.json names public events only; a payload passes its plain values, small', () => {
        assert.ok(EVENT_TYPES.includes('live.stream.started') && !EVENT_TYPES.some((t) => /^account|billing|chat\.message|dm/.test(t)), 'public types only');
        assert.deepStrictEqual(parseEvents('[{"function":"onlive","on":"live.stream.started"}]'), { list: [{ fn: 'onlive', on: 'live.stream.started' }], why: null });
        assert.match(parseEvents('[{"function":"x","on":"account.deleted"}]').why, /is not a public event/);
        assert.match(parseEvents('[{"function":"x","on":"billing.charge.created"}]').why, /is not a public event/);
        assert.deepStrictEqual(publicPayload({ title: 'Hi', viewers: 3, live: true, owner: { email: 'x' }, list: [1], 'bad key': 1 }), { title: 'Hi', viewers: 3, live: true });
        assert.ok(JSON.stringify(publicPayload({ a: 'x'.repeat(300), b: 'y'.repeat(300), c: 'z'.repeat(300), d: 'w'.repeat(300), e: 'v'.repeat(300), f: 'u'.repeat(300), g: 't'.repeat(300), h: 's'.repeat(300) })).length <= 2048);
    });

    const t = await boot();
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    const sched = t.ctx.spaceSchedules;
    try {
        await check('a delivered public event runs the space\'s function as the space, with the event; others are ignored', async () => {
            const r = await form(alice, '/spaces/new', { template: 'trivia' });
            const slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            const row = await t.ctx.spaces.getBySlug(slug);
            const files = (await t.ctx.spaces.files(row)).filter((f) => !f.path.startsWith('functions/'));
            await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: [...files,
                { path: 'functions/onlive.js', content: 'async function handle(r, ov) { await ov.store.set("seen", { t: r.headers["x-ov-trigger"], type: r.body.type, title: r.body.event.payload.title, who: ov.user, email: r.body.event.payload.email || null }); return { ok: true }; }' },
                { path: 'events.json', content: JSON.stringify([{ function: 'onlive', on: 'live.stream.started' }]) },
            ] });
            const ev = { event_id: 'evt_1', event_type: 'live.stream.started', timestamp: new Date().toISOString(), subject: { type: 'stream', id: 'str_1' }, payload: { title: 'Ada is live', email: { private: true } } };
            assert.strictEqual(sched.onEvent(ev), 'queued');
            await sched.settle();
            assert.strictEqual((await t.ctx.store.db.prepare('SELECT count(*) AS n FROM space_schedule_runs').get()).n, 0, 'a draft never runs');
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/publish`)).status, 200);
            assert.strictEqual(sched.onEvent(ev), 'queued');
            await sched.settle();
            const site = await t.ctx.store.db.prepare("SELECT id FROM space_sites WHERE status = 'active' AND active_deploy_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get();
            const runs = await sched.status(site.id);
            assert.deepStrictEqual(runs.map((x) => [x.function, x.trigger, x.last_status]), [['onlive', 'on live.stream.started', 'ok']]);
            assert.strictEqual(sched.onEvent({ event_type: 'account.deleted', event_id: 'evt_2' }), 'ignored:type', 'a private type is never dispatched');
            const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
            assert.match(page.text, /<b>onlive<\/b><span class="sp-muted">on live\.stream\.started<\/span>/, 'the editor names the event');
        });

        await check('Events\' delivery endpoint hands other topics to the spaces', () => {
            const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'app.js'), 'utf8');
            assert.match(app, /onEvent: \(ev\) => \(app\.locals\.hosting && app\.locals\.hosting\.spaceSchedules \? app\.locals\.hosting\.spaceSchedules\.onEvent\(ev\)/);
            const index = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'index.js'), 'utf8');
            assert.match(index, /topics: require\('\.\/spaces\/schedules'\)\.EVENT_TYPES/, 'subscribed apart from the account topics');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
