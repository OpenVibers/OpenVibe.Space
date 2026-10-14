'use strict';
/**
 * Space's storage usage readings → OpenVibe.Billing (plan T5 step 14, Space slice). The shape of OpenVibe.Media's
 * server/billing.js.
 *
 * Space emits one platform.usage-sample@1 metric, gb-month (Media's storage metric):
 *
 *   gb-month       the deploy bytes the local object store keeps for one closed UTC day, per (project, subject,
 *                  tier): every space_blobs row, i.e. each content-addressed blob once per project (the same bytes
 *                  in two projects are stored, and billed, twice), billed to the space_projects prj_ id and its
 *                  owner_subject. resource 'gb-month', provider the tier ('local'), unit 'GB', operation 'store'.
 *                  Each daily reading carries that day's share of a GB-month — bytes / GB / (days in that UTC
 *                  month) — so a month of daily readings sums to one GB-month.
 *
 * Media mode (SPACE_OBJECT_STORE=media, server/hosting-config.js) emits no reading: the bytes live in OpenVibe.Media,
 * and Media bills every present copy there itself (its server/billing.js), so Space's disk is only a read cache and
 * a reading here would bill the same bytes twice. A day aggregated in Media mode is not marked, and readings queued
 * before a switch to Media are still relayed.
 *
 * Sandbox and deleted projects are never recorded. The reporter is the SDK's own (openvibe-sdk/usage
 * createUsageReporter): it queues each reading idempotency-keyed in the outbox inside the transaction that marks the
 * day, and relays it to Billing's billing.usage.record (POST /api/v1/usage) with Space's Network service token
 * (clientId OV_OAUTH_CLIENT_ID, default 'space', audience openvibe.billing). A relay that cannot reach Billing stays
 * pending with backoff; only Billing refusing the reading itself is marked rejected. A reading is never edited
 * (migrations/0006_billing_readings.sql).
 *
 * Off by default: SPACE_BILLING_INTERVAL_MS=0 starts no timer and aggregates nothing. With an interval but no
 * OV_BILLING_URL (or OV_OAUTH_CLIENT_SECRET) readings are aggregated and stay queued.
 */
const { createUsageReporter } = require('openvibe-sdk/usage');
const { createServiceTokenClient } = require('openvibe-sdk/auth');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 5 * 60 * 1000;               // a day is aggregated only once this much of the next one passed
const GB = 1000 * 1000 * 1000;                // a GB in bytes: the unit gb-month is metered in
const TABLE = 'billing_readings';
const STORAGE = 'gb-month';
const TIER = 'local';                         // the only tier Space itself keeps bytes on

const dayStart = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;
const iso = (ms) => new Date(ms).toISOString();
/** Days in the UTC month containing `ms`: the divisor that turns a day's bytes into its share of a GB-month. */
function daysInMonth(ms) { const d = new Date(ms); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }

/**
 * @param {object} o
 * @param {object} o.db          Space's database (openvibe-sdk/db)
 * @param {object} o.config      the hosting config (server/hosting-config.js): billing, objectStore, oauth, networkInternalUrl
 * @param {() => number} [o.now]
 * @param {Function} [o.fetchImpl]
 * @param {object} [o.log]
 * @param {object} [o.reporter]  a ready createUsageReporter (tests); default one over `db`/`config`
 */
function createSpaceBilling({ db, config, now = () => Date.now(), fetchImpl = globalThis.fetch, log = console, reporter: injected } = {}) {
    const billing = config.billing || {};
    const intervalMs = Number(billing.intervalMs) || 0;
    const mediaMode = config.objectStore && config.objectStore.mode === 'media';
    let tokenClient = null;
    if (billing.url && config.oauth && config.oauth.clientSecret) {
        tokenClient = createServiceTokenClient({
            network: config.networkInternalUrl, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
            audience: billing.audience, fetch: fetchImpl, timeoutMs: billing.timeoutMs, now,
        });
    }
    const reporter = injected || createUsageReporter({
        db, service: 'space', source: 'space.billing', table: TABLE,
        billingUrl: billing.url, tokenClient, audience: billing.audience,
        fetchImpl, timeoutMs: billing.timeoutMs || 5000, now, log,
    });
    let lastError = null;

    const periodDone = (metric, periodStart) =>
        db.prepare('SELECT readings FROM billing_periods WHERE metric = ? AND period_start = ?').get(metric, periodStart);

    /**
     * Aggregate the closed UTC day [periodStart, +1d) into one gb-month reading per (project, subject), in the
     * transaction that marks the day. space_blobs keys a blob by (project, sha256), so each content-addressed blob
     * counts once per project however many deploys name it. A re-run of the day inserts nothing. Media mode: nothing.
     */
    async function aggregateStorageDay(periodStart, { now: at = now() } = {}) {
        if (periodStart !== dayStart(periodStart)) throw new RangeError(`billing: ${periodStart} is not the start of a day`);
        if (periodStart + DAY_MS + GRACE_MS > at) throw new RangeError(`billing: the day ${iso(periodStart)} has not closed`);
        if (mediaMode) return { period: periodStart, readings: 0, created: 0, skipped: 'media' };
        // Billing bills OpenVibe.Network projects: a reading names the project's network_project_id. A Space project
        // that names none (staff hosting before Network projects) has nobody Billing could bill, so it gets no reading.
        const rows = await db.prepare(`SELECT p.network_project_id AS project_id, p.owner_subject, SUM(b.size) AS bytes
                FROM space_blobs b JOIN space_projects p ON p.id = b.project_id
                WHERE p.status = 'active' AND p.environment = 'production' AND p.network_project_id IS NOT NULL
                GROUP BY p.network_project_id, p.owner_subject`).all();
        const days = daysInMonth(periodStart);
        return await db.tx(async (t) => {
            if (await periodDone(STORAGE, periodStart)) return { period: periodStart, readings: 0, created: 0, skipped: true };
            const day = iso(periodStart);
            let created = 0, count = 0;
            for (const row of rows) {
                const bytes = Number(row.bytes || 0);
                if (!(bytes > 0)) continue;
                const project = String(row.project_id), subject = row.owner_subject || undefined;
                const key = reporter.key('store', project, subject || '-', TIER, day);
                const reading = reporter.sample({ idempotency_key: key, project, subject,
                    resource: STORAGE, provider: TIER, operation: 'store', quantity: (bytes / GB) / days, unit: 'GB', at: day });
                if (await reporter.record(t, reading)) created++;
                count++;
            }
            await t.exec('INSERT INTO billing_periods (metric, period_start, readings, aggregated_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                [STORAGE, periodStart, count, at]);
            return { period: periodStart, readings: count, created };
        });
    }

    /**
     * Aggregate the newest closed UTC day. space_blobs holds only the current state, so a past day can never be
     * reconstructed: a day missed while the service was down is simply not billed.
     */
    async function aggregateClosed({ now: at = now() } = {}) {
        const r = await aggregateStorageDay(dayStart(at - GRACE_MS) - DAY_MS, { now: at });
        return { created: r.created };
    }

    /** One pass: aggregate the newest closed day, then relay what is due. Never overlaps itself; never throws. */
    let running = null;
    function tick() {
        if (!running) running = (async () => {
            try {
                const a = await aggregateClosed();
                const s = await reporter.flush();
                return { ...a, ...s };
            } catch (err) {
                lastError = err.message;
                log.error(`[Space] billing tick failed: ${err.message}`);
                return null;
            }
        })().finally(() => { running = null; });
        return running;
    }

    let timer = null;
    return {
        enabled: intervalMs > 0,
        reporting: !!tokenClient,
        mediaMode,
        reporter,
        aggregateStorageDay, aggregateClosed, tick,
        send: () => reporter.flush(),
        start() {
            if (timer || !(intervalMs > 0)) return false;
            if (mediaMode) log.warn('[Space] SPACE_OBJECT_STORE=media: Media bills the stored bytes, Space emits no storage readings');
            else if (!tokenClient) log.warn('[Space] OV_BILLING_URL or OV_OAUTH_CLIENT_SECRET is not set: billing readings are stored and stay queued');
            timer = setInterval(tick, intervalMs);
            if (timer.unref) timer.unref();
            return true;
        },
        async stop() {
            if (timer) clearInterval(timer);
            timer = null;
            if (running) await running;
            await reporter.stop();
        },
        get running() { return !!timer; },
        async status() {
            return {
                enabled: intervalMs > 0,
                reporting: !!tokenClient,
                media_mode: mediaMode,
                pending: await reporter.pending(),
                rejected: await reporter.rejected(),
                last_error: lastError,
            };
        },
    };
}

module.exports = { createSpaceBilling, DAY_MS, GRACE_MS, GB, TABLE, STORAGE, dayStart };
