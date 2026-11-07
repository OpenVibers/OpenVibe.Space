'use strict';
/**
 * The throwaway scratch sites of a chat plays session (Agent Streams S6, design 2026-11-06, §1 and §3).
 *
 * A chat plays run leaves a page behind: a scratch site at a throwaway OpenVibe.Space address. It has no
 * login and no form that collects anything, it is shown on stream, and it is removed after 24 hours unless
 * the owner keeps it.
 *
 * The job that removes them runs on a timer (SPACE_SCRATCH_CLEANUP_INTERVAL_MS, an hour by default) and once
 * when it starts. It is off with SPACE_SCRATCH_CLEANUP=off or SPACE_SCRATCH_CLEANUP_INTERVAL_MS=0.
 */
const SCRATCH_TTL_MS = 24 * 60 * 60 * 1000;

function createScratchSites({ store, config, log = console }) {
    const { db } = store;
    const q = {
        byId: db.prepare('SELECT * FROM space_sites WHERE id = ?'),
        markScratch: db.prepare('UPDATE space_sites SET scratch = true, scratch_expires_at = ?, scratch_kept = false, updated_at = ? WHERE id = ?'),
        keep: db.prepare('UPDATE space_sites SET scratch_kept = true, scratch_expires_at = NULL, updated_at = ? WHERE id = ?'),
        expired: db.prepare("SELECT id FROM space_sites WHERE scratch = true AND scratch_kept = false AND status = 'active' AND scratch_expires_at IS NOT NULL AND scratch_expires_at < ? LIMIT ?"),
        remove: db.prepare("UPDATE space_sites SET status = 'deleted', active_deploy_id = NULL, preview_deploy_id = NULL, preview_expires_at = NULL, deleted_at = ?, updated_at = ? WHERE id = ? AND scratch = true AND status = 'active'"),
    };

    /** Mark a site as a scratch site: it is removed after a day unless the owner keeps it. */
    async function mark(siteId, { now = store.now(), ttlMs = SCRATCH_TTL_MS } = {}) {
        const row = await q.byId.get(String(siteId || ''));
        if (!row) return { ok: false, code: 'scratch.no_such_site' };
        const expires = Number(now) + Number(ttlMs || SCRATCH_TTL_MS);
        await q.markScratch.run(expires, Number(now), row.id);
        return { ok: true, site_id: row.id, name: row.name, expires_at: expires };
    }

    /** The owner keeps it: the site stays past its day. */
    async function keep(siteId, { now = store.now() } = {}) {
        const row = await q.byId.get(String(siteId || ''));
        if (!row) return { ok: false, code: 'scratch.no_such_site' };
        await q.keep.run(Number(now), row.id);
        return { ok: true, site_id: row.id, name: row.name, kept: true };
    }

    /** The scratch sites whose day is up: removed, and how many. */
    async function removeExpired({ now = store.now(), limit = 500 } = {}) {
        const rows = await q.expired.all(Number(now), limit);
        let n = 0;
        for (const row of rows) {
            const r = await q.remove.run(Number(now), Number(now), row.id);
            if (Number(r.changes) > 0) n++;
        }
        return n;
    }

    return { mark, keep, removeExpired, SCRATCH_TTL_MS };
}

/**
 * The job that removes the scratch sites whose day is up. The same shape as the guest cleanup job: a timer,
 * a run that never overlaps itself, and a way to stop it.
 */
function createScratchCleanup({ store, config, log = console }) {
    const scratch = createScratchSites({ store, config, log });
    let timer = null;
    let running = false;

    async function run() {
        if (running) return 0;
        running = true;
        try {
            const n = await scratch.removeExpired();
            if (n) log.info?.(`[Space] ${n} scratch site(s) removed: their day was up`);
            return n;
        } catch (err) {
            log.warn?.('[Space] the scratch cleanup failed: ' + err.message);
            return 0;
        } finally {
            running = false;
        }
    }

    function start() {
        const interval = Number(config.spaces && config.spaces.scratchCleanupIntervalMs) || 0;
        if (interval <= 0) return;
        run();
        timer = setInterval(run, interval);
        if (timer.unref) timer.unref();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { ...scratch, run, start, stop };
}

module.exports = { createScratchSites, createScratchCleanup, SCRATCH_TTL_MS };
