'use strict';
/**
 * The job that removes the guest drafts whose time is up (openvibe.website, plan 5.9).
 *
 * A guest draft lives seven days after its last edit (the editor's saves and AI changes push the time up).
 * When it is up the draft is gone: the space row, its files and everything a visitor ever put in it go with it
 * (the tables cascade). Nothing of a guest's is kept after a week.
 *
 * The job runs on a timer (SPACE_GUEST_CLEANUP_INTERVAL_MS, an hour by default) and once when it starts. It is
 * off with SPACE_GUEST_DRAFTS=off or SPACE_GUEST_CLEANUP_INTERVAL_MS=0, so a drill or a test can leave it alone.
 */
function createGuestCleanup({ store, config, log = console }) {
    const limits = config.spaces.guest;
    let timer = null;
    let running = false;

    const q = {
        expired: store.db.prepare('SELECT id FROM space_apps WHERE guest_hash IS NOT NULL AND guest_expires_at IS NOT NULL AND guest_expires_at < ? LIMIT ?'),
        remove: store.db.prepare('DELETE FROM space_apps WHERE id = ? AND guest_hash IS NOT NULL AND guest_expires_at IS NOT NULL AND guest_expires_at < ?'),
    };

    /** The drafts that are up: removed, and how many. */
    async function run() {
        if (running) return 0;
        running = true;
        try {
            const now = store.now();
            const rows = await q.expired.all(now, 500);
            let n = 0;
            for (const row of rows) {
                const r = await q.remove.run(row.id, now);
                n += Number((r && r.changes) || 0);
            }
            if (n) (log.info || log.log || log.warn)(`[Spaces] ${n} expired guest draft${n === 1 ? '' : 's'} removed`);
            return n;
        } catch (err) {
            log.warn(`[Spaces] guest draft cleanup: ${err && err.message}`);
            return 0;
        } finally { running = false; }
    }

    return {
        run,
        start() {
            if (!limits.enabled || limits.cleanupIntervalMs <= 0) return;
            if (timer) return;
            timer = setInterval(() => { run(); }, limits.cleanupIntervalMs);
            if (timer.unref) timer.unref();
            run();
        },
        stop() { if (timer) clearInterval(timer); timer = null; },
    };
}

module.exports = { createGuestCleanup };
