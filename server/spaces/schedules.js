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
 */
const fs = require('fs');

const MAX_SCHEDULES = 5;
const MAX_FILE = 4096;
const MIN_S = 15 * 60;
const MAX_S = 7 * 86400;
const PER_TICK = 20;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

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
        runs: db.prepare('SELECT fn, last_run_at FROM space_schedule_runs WHERE site_id = ?'),
        status: db.prepare('SELECT fn, every_s, last_run_at, last_status, last_ms, last_error, runs FROM space_schedule_runs WHERE site_id = ? ORDER BY fn'),
        record: db.prepare(`INSERT INTO space_schedule_runs (site_id, fn, every_s, last_run_at, last_status, last_ms, last_error, runs)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT (site_id, fn) DO UPDATE SET every_s = EXCLUDED.every_s, last_run_at = EXCLUDED.last_run_at,
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

    async function runOne({ row, fn, every }) {
        const started = now();
        const done = async (status, error = null) => {
            await q.record.run(row.site_id, fn, every, new Date(started).toISOString(), status, Math.max(0, now() - started), error ? String(error).slice(0, 300) : null);
        };
        try {
            const a = typeof apps === 'function' ? apps() : apps;
            const space = a ? await a.forSite(row.site_id) : null;
            if (!space) return done('error', 'the space is not published');
            const file = await q.file.get(row.deploy_id, `functions/${fn}.js`);
            if (!file || file.project_id !== row.project_id) return done('error', `there is no functions/${fn}.js`);
            const code = await read(file.project_id, file.sha256);
            const at = new Date(started).toISOString();
            const request = { method: 'POST', path: `/api/${fn}`, query: {}, headers: { 'content-type': 'application/json', 'x-ov-trigger': 'schedule' }, body: { trigger: 'schedule', at } };
            const out = await a.runFunction(space, fn, code, request, { caller: `schedule:${row.site_id}` });
            // The sandbox answers { status, headers, body, logs }; a failure is a 4xx or 5xx with its reason as the body.
            const code_ = Number(out && out.status) || 500;
            if (code_ >= 400) return done('error', `${code_}: ${String((out && out.body) || '').slice(0, 240)}`);
            return done('ok');
        } catch (err) {
            log.warn('[Space schedules] run failed:', row.site_id, fn, err && err.message);
            return done('error', (err && err.message) || 'failed').catch(() => {});
        }
    }

    return {
        enabled,
        tick,
        /** The last run of each schedule of a site, for the editor. */
        status: async (siteId) => (await q.status.all(siteId)).map((r) => ({ function: r.fn, every_s: r.every_s, last_run_at: r.last_run_at ? new Date(r.last_run_at).toISOString() : null, last_status: r.last_status, last_ms: r.last_ms, last_error: r.last_error, runs: r.runs })),
        start() {
            if (!enabled || timer) return;
            timer = setInterval(() => { tick().catch((err) => log.warn('[Space schedules] tick failed:', err && err.message)); }, Number(opts.intervalMs));
            if (timer.unref) timer.unref();
        },
        stop() { if (timer) clearInterval(timer); timer = null; },
    };
}

module.exports = { createSpaceSchedules, parseSchedules, everySeconds, MAX_SCHEDULES, MIN_S };
