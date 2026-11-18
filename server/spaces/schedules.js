'use strict';
/**
 * Spaces that keep working (plan §AD.15: "triggers: a schedule, a webhook, an event from any OpenVibe site, or a
 * person"). A published space may list schedules.json at its root:
 *
 *   [{ "function": "refresh", "every": "1h" }, { "function": "digest", "every": "1d" }]
 *
 * and its functions/<function>.js (the published copy, as /api/<function> serves it) runs on that clock as the space
 * itself: no visitor, `request.method` "POST", the header x-ov-trigger: schedule and the body { trigger, at }. A webhook
 * is already /api/<name> (POST), and a person is the page calling it; this adds the clock.
 *
 *   every   15m to 7d: "<n>m", "<n>h" or "<n>d"; at most MAX_SCHEDULES per space
 *   runs    one at a time, at most PER_TICK a tick, each with the function sandbox's own limits; the last run of each
 *           (when, ok or not, how long, the error) is kept in space_schedule_runs for the editor
 *
 * The job is off with SPACE_SCHEDULES=off or SPACE_SCHEDULES_INTERVAL_MS=0 (a drill or a test leaves it alone) and
 * runs once a minute otherwise.
 *
 * Events (the third trigger): events.json lists [{ "function": "onlive", "on": "live.stream.started" }]; when OpenVibe.Events
 * delivers one of the PUBLIC event types below, each published space that listed it runs that function as the space,
 * with x-ov-trigger: event and the body { trigger: "event", type, at, event: { id, subject, payload } } (the payload's
 * plain values only, 2 KB at most). Nothing private reaches a space: only these types are subscribed and dispatched.
 *
 * Spaces that talk (plan §AD.15: "one space's output feeds another (a price watch feeds a budget); this is the agentic
 * graph"): a space says something by keeping `out.<topic>` in its own store (ov.store.set("out.price", { usd: 12 })), and
 * another space listens with events.json's { "function": "onprice", "on": "space:<its slug>/price" }. The listener runs
 * like any event, with type "space:<slug>/<topic>", subject { type: "space", id: <slug> } and the value's plain values
 * as the payload. A space hears only a public published space or one of its own maker's, never itself, and a space says
 * at most TELL_PER_MINUTE things a minute (a loop between spaces runs dry).
 */
const fs = require('fs');

const MAX_SCHEDULES = 5;
const MAX_FILE = 4096;
const MIN_S = 15 * 60;
const MAX_S = 7 * 86400;
const PER_TICK = 20;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Another space's output: space:<slug>/<topic> (a slug as Space makes them; a topic as a store key after "out.").
const SPACE_ON_RE = /^space:([a-z0-9][a-z0-9-]{0,62})\/([a-z0-9][a-z0-9_.-]{0,40})$/;
const TOPIC_RE = /^[a-z0-9][a-z0-9_.-]{0,40}$/;
const TELL_PER_MINUTE = 30;
// The public event types a space may listen to (OpenVibe.Events' own public list, server/home.js TYPE_WORDS).
const EVENT_TYPES = Object.freeze([
    'live.stream.started', 'live.stream.ended', 'blog.post.published', 'wiki.page.published', 'community.paste.created',
    'community.thread.created', 'coupons.coupon.created', 'deals.offer.created', 'deals.offer.updated',
    'games.world.published', 'services.app.published', 'reviews.signal.added', 'trade.observation.created',
]);
const MAX_PAYLOAD = 2048;
const PER_EVENT = 50;
const QUEUE_MAX = 200;

/** "15m" | "2h" | "1d" → seconds, or null. */
function everySeconds(v) {
    const m = /^(\d{1,4})\s*(m|h|d)$/.exec(String(v || '').trim().toLowerCase());
    if (!m) return null;
    const s = Number(m[1]) * { m: 60, h: 3600, d: 86400 }[m[2]];
    return s >= MIN_S && s <= MAX_S ? s : null;
}

/** schedules.json's text → { list: [{ fn, every }], why } (what is wrong in it, for the editor). */
function parseSchedules(text) {
    let j;
    try { j = JSON.parse(String(text || '')); } catch { return { list: [], why: 'schedules.json is not valid JSON' }; }
    if (!Array.isArray(j)) return { list: [], why: 'schedules.json is a list of { function, every }' };
    const list = [];
    for (const s of j.slice(0, MAX_SCHEDULES)) {
        const fn = s && String(s.function || '').trim();
        const every = s && everySeconds(s.every);
        if (!fn || !NAME_RE.test(fn)) return { list: [], why: `"${String(fn || '').slice(0, 40)}" is not a function name` };
        if (!every) return { list: [], why: `${fn}: every is 15m to 7d ("15m", "1h", "1d")` };
        if (!list.some((x) => x.fn === fn)) list.push({ fn, every });
    }
    return { list, why: j.length > MAX_SCHEDULES ? `only the first ${MAX_SCHEDULES} schedules run` : null };
}

/** events.json's text → { list: [{ fn, on }], why }. */
function parseEvents(text) {
    let j;
    try { j = JSON.parse(String(text || '')); } catch { return { list: [], why: 'events.json is not valid JSON' }; }
    if (!Array.isArray(j)) return { list: [], why: 'events.json is a list of { function, on }' };
    const list = [];
    for (const s of j.slice(0, MAX_SCHEDULES)) {
        const fn = s && String(s.function || '').trim();
        const on = s && String(s.on || '').trim();
        if (!fn || !NAME_RE.test(fn)) return { list: [], why: `"${String(fn || '').slice(0, 40)}" is not a function name` };
        if (!EVENT_TYPES.includes(on) && !SPACE_ON_RE.test(on)) return { list: [], why: `${fn}: "${on.slice(0, 60)}" is not a public event (one of ${EVENT_TYPES.join(', ')}) or another space's output (space:<slug>/<topic>)` };
        if (!list.some((x) => x.fn === fn && x.on === on)) list.push({ fn, on });
    }
    return { list, why: j.length > MAX_SCHEDULES ? `only the first ${MAX_SCHEDULES} run` : null };
}

/** An event's payload as a space may see it: plain values only (no objects in objects), 2 KB at most. */
function publicPayload(p) {
    const out = {};
    for (const [k, v] of Object.entries(p && typeof p === 'object' && !Array.isArray(p) ? p : {})) {
        if (!/^[a-z][a-z0-9_]{0,40}$/i.test(k)) continue;
        if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
        else if (typeof v === 'string') out[k] = v.slice(0, 300);
        if (JSON.stringify(out).length > MAX_PAYLOAD) { delete out[k]; break; }
    }
    return out;
}

function createSpaceSchedules({ store, blobs, apps, config = {}, log = console }) {
    const { db } = store;
    const now = () => (typeof store.now === 'function' ? store.now() : Date.now());
    const opts = (config.spaces && config.spaces.schedules) || {};
    const enabled = opts.enabled !== false && Number(opts.intervalMs) > 0;
    const q = {
        sites: db.prepare(`SELECT s.id AS site_id, s.project_id, s.active_deploy_id AS deploy_id, f.sha256, f.size
            FROM space_sites s JOIN space_projects p ON p.id = s.project_id AND p.status = 'active'
            JOIN space_deploy_files f ON f.deploy_id = s.active_deploy_id AND f.path = 'schedules.json'
            JOIN space_deploys d ON d.id = s.active_deploy_id AND d.state = 'ready'
            WHERE s.status = 'active' ORDER BY s.id LIMIT 2000`),
        file: db.prepare(`SELECT f.sha256, f.size, d.project_id FROM space_deploy_files f JOIN space_deploys d ON d.id = f.deploy_id
            WHERE f.deploy_id = ? AND f.path = ? AND d.state = 'ready'`),
        eventSites: db.prepare(`SELECT s.id AS site_id, s.project_id, s.active_deploy_id AS deploy_id, f.sha256, f.size
            FROM space_sites s JOIN space_projects p ON p.id = s.project_id AND p.status = 'active'
            JOIN space_deploy_files f ON f.deploy_id = s.active_deploy_id AND f.path = 'events.json'
            JOIN space_deploys d ON d.id = s.active_deploy_id AND d.state = 'ready'
            WHERE s.status = 'active' ORDER BY s.id LIMIT 2000`),
        runs: db.prepare("SELECT fn, last_run_at FROM space_schedule_runs WHERE site_id = ? AND (trigger = '' OR trigger LIKE 'every %')"),
        status: db.prepare('SELECT fn, every_s, trigger, last_run_at, last_status, last_ms, last_error, runs FROM space_schedule_runs WHERE site_id = ? ORDER BY fn, trigger'),
        record: db.prepare(`INSERT INTO space_schedule_runs (site_id, fn, every_s, trigger, last_run_at, last_status, last_ms, last_error, runs)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT (site_id, fn) DO UPDATE SET every_s = EXCLUDED.every_s, trigger = EXCLUDED.trigger, last_run_at = EXCLUDED.last_run_at,
                last_status = EXCLUDED.last_status, last_ms = EXCLUDED.last_ms, last_error = EXCLUDED.last_error,
                runs = space_schedule_runs.runs + 1`),
    };
    const read = async (projectId, sha256) => fs.promises.readFile(await blobs.ensure(projectId, sha256), 'utf8');
    let timer = null;
    let running = false;

    /** One pass: every due schedule of every published space, oldest first, at most PER_TICK runs. */
    async function tick() {
        if (running) return { ran: 0, skipped: 'busy' };
        running = true;
        let ran = 0;
        try {
            const due = [];
            for (const row of await q.sites.all()) {
                if (Number(row.size) > MAX_FILE) continue;
                let parsed;
                try { parsed = parseSchedules(await read(row.project_id, row.sha256)); } catch (err) { log.warn('[Space schedules] unreadable schedules.json:', row.site_id, err.message); continue; }
                if (!parsed.list.length) continue;
                const last = new Map((await q.runs.all(row.site_id)).map((r) => [r.fn, r.last_run_at ? new Date(r.last_run_at).getTime() : 0]));
                for (const s of parsed.list) {
                    const at = last.get(s.fn) || 0;
                    if (now() - at >= s.every * 1000) due.push({ row, ...s, at });
                }
            }
            due.sort((a, b) => a.at - b.at);
            for (const d of due.slice(0, PER_TICK)) { await runOne(d); ran++; }
        } finally { running = false; }
        return { ran };
    }

    async function runOne({ row, fn, every = 0, on = null, event = null }) {
        const started = now();
        const trigger = on ? `on ${on}` : `every ${every}`;
        const done = async (status, error = null) => {
            await q.record.run(row.site_id, fn, every, trigger, new Date(started).toISOString(), status, Math.max(0, now() - started), error ? String(error).slice(0, 300) : null);
        };
        try {
            const a = typeof apps === 'function' ? apps() : apps;
            const space = a ? await a.forSite(row.site_id) : null;
            if (!space) return done('error', 'the space is not published');
            const file = await q.file.get(row.deploy_id, `functions/${fn}.js`);
            if (!file || file.project_id !== row.project_id) return done('error', `there is no functions/${fn}.js`);
            const code = await read(file.project_id, file.sha256);
            const at = new Date(started).toISOString();
            const body = event ? { trigger: 'event', type: on, at, event } : { trigger: 'schedule', at };
            const request = { method: 'POST', path: `/api/${fn}`, query: {}, headers: { 'content-type': 'application/json', 'x-ov-trigger': event ? 'event' : 'schedule' }, body };
            const out = await a.runFunction(space, fn, code, request, { caller: `${event ? 'event' : 'schedule'}:${row.site_id}` });
            // The sandbox answers { status, headers, body, logs }; a failure is a 4xx or 5xx with its reason as the body.
            const code_ = Number(out && out.status) || 500;
            if (code_ >= 400) return done('error', `${code_}: ${String((out && out.body) || '').slice(0, 240)}`);
            return done('ok');
        } catch (err) {
            log.warn('[Space schedules] run failed:', row.site_id, fn, err && err.message);
            return done('error', (err && err.message) || 'failed').catch(() => {});
        }
    }

    // Events arrive in Events' delivery request: they are queued and run after the answer, one at a time.
    const queue = [];
    let draining = false;
    async function drain() {
        if (draining) return;
        draining = true;
        try {
            while (queue.length) {
                const ev = queue.shift();
                for (const row of await q.eventSites.all()) {
                    if (Number(row.size) > MAX_FILE) continue;
                    let parsed;
                    try { parsed = parseEvents(await read(row.project_id, row.sha256)); } catch { continue; }
                    const hits = parsed.list.filter((x) => x.on === ev.type).slice(0, PER_EVENT);
                    if (!hits.length) continue;
                    // Another space's output: heard by a space of the same maker, or from a public one; never by itself.
                    if (ev.from) {
                        const a = typeof apps === 'function' ? apps() : apps;
                        const listener = a ? await a.forSite(row.site_id) : null;
                        if (!listener || listener.id === ev.from.id) continue;
                        if (!ev.from.open && !(ev.from.owner && listener.owner_subject === ev.from.owner)) continue;
                    }
                    for (const t of hits) await runOne({ row, fn: t.fn, on: t.on, event: ev.event });
                }
            }
        } catch (err) { log.warn('[Space events] dispatch failed:', err && err.message); }
        finally { draining = false; }
    }
    /** OpenVibe.Events' delivery of an event (the account-data consumer's onEvent): a public type is queued for the spaces. */
    function onEvent(ev) {
        const type = ev && String(ev.event_type || '');
        if (!EVENT_TYPES.includes(type)) return 'ignored:type';
        if (queue.length >= QUEUE_MAX) return 'ignored:busy';
        queue.push({ type, event: { id: String(ev.event_id || ''), at: ev.timestamp || null, subject: ev.subject && typeof ev.subject === 'object' ? { type: String(ev.subject.type || '').slice(0, 40), id: String(ev.subject.id || '').slice(0, 80) } : null, payload: publicPayload(ev.payload) } });
        setImmediate(() => { drain().catch(() => {}); });
        return 'queued';
    }

    /** A space said something (its own store's out.<topic>): queued for the spaces that listen to it. */
    const told = new Map();   // space id → the times it said something this minute
    function tell(space, topic, value) {
        if (!space || !space.id || !space.slug || !space.site_id || !TOPIC_RE.test(String(topic || ''))) return 'ignored';
        const t = now();
        const recent = (told.get(space.id) || []).filter((x) => t - x < 60000);
        if (recent.length >= TELL_PER_MINUTE) return 'ignored:busy';
        if (queue.length >= QUEUE_MAX) return 'ignored:busy';
        recent.push(t); told.set(space.id, recent);
        if (told.size > 5000) told.clear();
        const payload = publicPayload(value && typeof value === 'object' && !Array.isArray(value) ? value : { value });
        queue.push({
            type: `space:${space.slug}/${topic}`,
            from: { id: space.id, owner: space.owner_subject || null, open: space.visibility === 'public' },
            event: { id: `spk_${space.id}_${t}`, at: new Date(t).toISOString(), subject: { type: 'space', id: space.slug }, payload },
        });
        setImmediate(() => { drain().catch(() => {}); });
        return 'queued';
    }

    return {
        enabled,
        onEvent,
        tell,
        /** Wait for the queued events to run (tests). */
        settle: async () => { while (draining || queue.length) await new Promise((r) => setTimeout(r, 10)); },
        tick,
        /** The last run of each schedule of a site, for the editor. */
        status: async (siteId) => (await q.status.all(siteId)).map((r) => ({ function: r.fn, every_s: r.every_s, trigger: r.trigger, last_run_at: r.last_run_at ? new Date(r.last_run_at).toISOString() : null, last_status: r.last_status, last_ms: r.last_ms, last_error: r.last_error, runs: r.runs })),
        start() {
            if (!enabled || timer) return;
            timer = setInterval(() => { tick().catch((err) => log.warn('[Space schedules] tick failed:', err && err.message)); }, Number(opts.intervalMs));
            if (timer.unref) timer.unref();
        },
        stop() { if (timer) clearInterval(timer); timer = null; },
    };
}

module.exports = { createSpaceSchedules, parseSchedules, parseEvents, publicPayload, everySeconds, EVENT_TYPES, MAX_SCHEDULES, MIN_S, SPACE_ON_RE, TELL_PER_MINUTE };
