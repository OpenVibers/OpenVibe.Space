'use strict';
/**
 * OpenVibe.Events → Space: POST /internal/events, the endpoint of Space's Events subscriptions
 * (consumer `space`, created at boot by startSubscriptions()). The forum keeps its tables honest with
 * what the rest of the network says about people:
 *
 *   network.user.token_valid_after   revocation (WS-B task 4): the person's token cutoff moves
 *                                    (openvibe-sdk createPgRevocationStore); the viewer resolver refuses
 *                                    their older tokens.
 *   network.block.changed            platform blocks (WS-E task 5): the network_blocks projection
 *                                    (../identity/blocks.js; the newest revision per pair wins) that
 *                                    replies honour.
 *   network.subject.merged           two accounts became one (ADR-029): the folded-in subject's rows
 *                                    become the survivor's (../identity/subject-merge.js).
 *   network.account.export_requested Space's part of an account export (../identity/account-data.js).
 *   network.account.deleted          what the subject wrote goes (or becomes a tombstone) and Space
 *                                    confirms with counts.
 *   vip.membership.changed           VIP convergence: the member's cached members-only answers for that
 *                                    creator are dropped at once (the VIP gate's cache handleEvent)
 *                                    instead of waiting out its TTL.
 *
 * Pulse item creation is NOT here: the network Pulse feed is OpenVibe.Community's (plan T10 D3, D12),
 * and Space stores none of it.
 *
 * Exactly once: the openvibe-sdk inbox claims (consumer, event_id) in the same transaction as the write.
 * Signature v2 only (parseDelivery requireV2) under SPACE_EVENTS_SECRET (comma-separated for rotation,
 * 32+ characters each); unset = 503. Loopback only: a request carrying a forwarding header came
 * through nginx and is refused.
 */
const express = require('express');
const { http, serviceAuth } = require('openvibe-contracts');
const { parseDelivery, createPgInbox } = require('openvibe-sdk/events');
const blocks = require('./identity/blocks');

const CONSUMER = 'space';
const TOPICS = Object.freeze(['vip.membership.changed', 'network.user.token_valid_after', 'network.block.changed', 'network.subject.merged', 'network.account.export_requested', 'network.account.deleted']);
const EVENT_ID_RE = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/;

function createEventsConsumer({ db, secrets = [], vipCache = null, revocations = null, accountSend = null, now = () => Date.now(), log = console } = {}) {
    const keys = (secrets || []).filter((s) => typeof s === 'string' && s.length >= 32);
    // Receipts (space_event_inbox) are in migrations/0001_initial.sql.
    const inbox = createPgInbox(db, { table: 'space_event_inbox', now });
    const stats = { received: 0, applied: 0, duplicates: 0, ignored: 0, refused: 0, failed: 0, last_at: null };
    const router = express.Router();
    router.post('/', express.raw({ type: () => true, limit: '256kb' }), async (req, res) => {
        const ctx = http.requestContext(req.headers);
        const problem = (status, code, detail) => http.sendProblem(res, status, code, { detail, ctx });
        if (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['cf-connecting-ip']) return problem(403, 'space.internal_only', 'internal route');
        if (!keys.length) return problem(503, 'space.events_disabled', 'SPACE_EVENTS_SECRET is not set');
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        let delivery = null;
        for (const s of keys) { delivery = parseDelivery(raw, req.headers, s, { requireV2: true, now: now() }); if (delivery) break; }
        if (!delivery) { stats.refused++; return problem(401, 'space.bad_signature', 'X-OpenVibe-Signature-V2 does not verify or is outside the replay window'); }
        const event = delivery.event;
        if (!event || !EVENT_ID_RE.test(String(event.event_id || '')) || typeof event.event_type !== 'string') { stats.refused++; return problem(400, 'space.bad_delivery', 'body must be { event: <envelope>, seq }'); }
        stats.received++; stats.last_at = new Date(now()).toISOString();
        if (event.event_type === 'network.user.token_valid_after') {
            if (!revocations) { stats.ignored++; return res.json({ event_id: event.event_id, duplicate: false, outcome: 'ignored:no_store' }); }
            const r = await inbox.once(CONSUMER, event.event_id, async () => ({ outcome: await revocations.apply(event) }));
            if (r.duplicate) stats.duplicates++; else stats.applied++;
            return res.json({ event_id: event.event_id, duplicate: r.duplicate, outcome: r.duplicate ? null : r.result.outcome });
        }
        if (event.event_type === 'network.block.changed') {
            const p = blocks.payloadOf(event);
            if (typeof p === 'string') { stats.ignored++; return res.json({ event_id: event.event_id, duplicate: false, outcome: p }); }
            try {
                const r = await inbox.once(CONSUMER, event.event_id, async () => ({ outcome: await blocks.apply(db, p, now()) }));
                if (r.duplicate) stats.duplicates++; else stats.applied++;
                return res.json({ event_id: event.event_id, duplicate: r.duplicate, outcome: r.duplicate ? null : r.result.outcome });
            } catch (err) {
                stats.failed++;
                log.error(`[Events consumer] ${event.event_id} (${event.event_type}) failed:`, err.message);
                return problem(500, 'space.event_failed', 'processing failed; it will be retried');
            }
        }
        if (event.event_type === 'network.account.export_requested' || event.event_type === 'network.account.deleted') {
            // Account export and deletion (ADR-033, ./identity/account-data.js): once per export or deletion by its own
            // record, answered after Network took the part or the confirmation, so a failure is redelivered without
            // erasing twice.
            if (!accountSend) { stats.ignored++; return res.json({ event_id: event.event_id, duplicate: false, outcome: 'ignored:no_client' }); }
            return require('./identity/account-data').apply(db, event, { send: accountSend, log }).then((outcome) => {
                stats.applied++;
                res.json({ event_id: event.event_id, duplicate: outcome === 'unchanged', outcome });
            }, (err) => {
                stats.failed++;
                log.error(`[Events consumer] ${event.event_id} (${event.event_type}) failed:`, err.message);
                problem(500, 'space.event_failed', 'processing failed; it will be retried');
            });
        }
        if (event.event_type === 'network.subject.merged') {
            // Two accounts became one (ADR-029): the folded-in subject's rows become the survivor's (./identity/subject-merge.js).
            const merge = require('./identity/subject-merge');
            const p = merge.payloadOf(event);
            if (typeof p === 'string') { stats.ignored++; return res.json({ event_id: event.event_id, duplicate: false, outcome: p }); }
            try {
                const r = await inbox.once(CONSUMER, event.event_id, async () => ({ outcome: await merge.apply(db, p, { log }) }));
                if (r.duplicate) stats.duplicates++; else stats.applied++;
                return res.json({ event_id: event.event_id, duplicate: r.duplicate, outcome: r.duplicate ? null : r.result.outcome });
            } catch (err) {
                stats.failed++;
                log.error(`[Events consumer] ${event.event_id} (${event.event_type}) failed:`, err.message);
                return problem(500, 'space.event_failed', 'processing failed; it will be retried');
            }
        }
        if (event.event_type === 'vip.membership.changed') {
            if (event.source !== 'vip' || !vipCache) { stats.ignored++; return res.json({ event_id: event.event_id, duplicate: false, outcome: event.source !== 'vip' ? 'ignored:source' : 'ignored:no_gate' }); }
            const r = await inbox.once(CONSUMER, event.event_id, () => ({ outcome: vipCache.handleEvent(event) ? 'vip:invalidated' : 'vip:unchanged' }));
            if (r.duplicate) stats.duplicates++; else stats.applied++;
            return res.json({ event_id: event.event_id, duplicate: r.duplicate, outcome: r.duplicate ? null : r.result.outcome });
        }
        stats.ignored++;
        return res.json({ event_id: event.event_id, duplicate: false, outcome: 'ignored:type' });
    });
    return { router, stats: () => ({ ...stats, enabled: keys.length > 0 }) };
}

/** Create any missing subscription for TOPICS at Events (idempotent; retried in the background at boot). */
function startSubscriptions({ config, port, secret, eventsUrl = process.env.EVENTS_URL, fetchImpl = globalThis.fetch, log = console }) {
    if (!eventsUrl || !secret || !config.oauth.clientSecret || process.env.SPACE_EVENTS_SUBSCRIBE === '0') return null;
    const base = String(eventsUrl).replace(/\/+$/, '');
    const endpoint = process.env.SPACE_EVENTS_ENDPOINT || `http://127.0.0.1:${port}/internal/events`;
    const tokens = serviceAuth.createTokenClient({ tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, audience: 'openvibe.events', scope: 'events.subscription.manage', fetchImpl });
    const call = async (method, path, body) => {
        const res = await fetchImpl(`${base}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await tokens.authHeaders()) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, ok: res.ok, body: json };
    };
    const attempt = async () => {
        const listed = await call('GET', '/api/v1/subscriptions');
        if (!listed.ok) throw new Error(`listing subscriptions: ${listed.status}`);
        const mine = (listed.body.subscriptions || []).filter((s) => s.endpoint === endpoint);
        for (const topic of TOPICS) {
            if (mine.some((s) => s.topic_pattern === topic)) continue;
            const r = await call('POST', '/api/v1/subscriptions', { topic_pattern: topic, endpoint, secret });
            if (!r.ok && r.status !== 409) throw new Error(`subscribing to ${topic}: ${r.status} ${r.body.code || ''}`);
            if (r.ok) log.log(`[Events consumer] subscription created: ${r.body.id} (${topic} → ${endpoint})`);
        }
    };
    const delays = [0, 10_000, 60_000, 5 * 60_000, 15 * 60_000];
    let i = 0;
    let timer = null;
    let stopped = false;
    const run = () => { timer = null; if (stopped) return; attempt().catch((err) => {
        if (stopped) return;
        if (++i < delays.length) { timer = setTimeout(run, delays[i]); if (timer.unref) timer.unref(); } else log.warn('[Events consumer] subscriptions not created:', err.message);
    }); };
    timer = setTimeout(run, delays[0]); if (timer.unref) timer.unref();
    // Graceful stop: no further attempts (they run again at the next start).
    return { topics: TOPICS, endpoint, stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; } };
}

module.exports = { createEventsConsumer, startSubscriptions, TOPICS };
