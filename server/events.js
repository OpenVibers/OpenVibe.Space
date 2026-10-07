'use strict';
/**
 * Space → OpenVibe.Events (contracts space.*@1).
 *
 *   space.thread.created, space.post.created   server/forum/store.js
 *   space.moderation.action                    server/forum/service.js (staff actions on others' content)
 *
 * Each event is written to Space's own outbox inside the SAME transaction as the change (the SDK
 * outbox refuses anything else), and a relay publishes it with Space's service token (audience
 * openvibe.events, capability events.event.publish). Events down: rows wait and are retried; a write
 * never waits on Events. Payloads carry ids, the author subject, visibility and the public URL, never
 * a body or a title. Envelope visibility is public only for public items.
 *
 * Off unless EVENTS_URL and OV_OAUTH_CLIENT_SECRET are set (EVENTS_PUBLISH=off disables it).
 *
 * The event types are the forum's own namespace (plan T10 D3: the forum's contracts are Space's).
 * OpenVibe.Contracts must publish the space.thread.created / space.post.created / space.moderation.action
 * payload contracts before this producer is switched on: Events refuses an event type it has no contract
 * for, and both this and the Discord relay's Events worker are off without EVENTS_URL.
 */
const { createClient } = require('openvibe-sdk/core');
const { createServiceTokenClient } = require('openvibe-sdk/auth');
const { createEventsClient, createPgOutbox } = require('openvibe-sdk/events');
const config = require('./config');

let outbox = null;
let outboxDb = null;   // the handle enqueue() writes through (it joins the caller's ambient transaction)
let pruneTimer = null;
const stats = { queued: 0, lastError: null };
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

function init(db, { eventsUrl = process.env.EVENTS_URL, clientSecret = config.oauth && config.oauth.clientSecret, fetchImpl, intervalMs } = {}) {
    if (outbox) return outbox;
    if (process.env.EVENTS_PUBLISH === 'off' || !eventsUrl || !clientSecret) return null;
    const tokens = createServiceTokenClient({ tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: (config.oauth && config.oauth.clientId) || 'space', clientSecret, fetch: fetchImpl });
    const client = createClient({ baseUrls: { events: String(eventsUrl).replace(/\/+$/, '') }, tokenProvider: tokens, fetch: fetchImpl, retries: 0 });
    outboxDb = db;
    // The PostgreSQL outbox (its table is in migrations/0001_initial.sql); several processes relay it safely (leases).
    outbox = createPgOutbox(db, {
        events: createEventsClient(client, { source: 'space' }),
        intervalMs: intervalMs || 2000,
        onError: (err) => { const m = err && err.message; if (m !== stats.lastError) console.warn('[Events] publish failed (will retry):', m); stats.lastError = m; },
    });
    outbox.start();
    pruneTimer = setInterval(() => { outbox.prune().catch(() => { /* next time */ }); }, PRUNE_EVERY_MS);
    if (pruneTimer.unref) pruneTimer.unref();
    outbox.pending().then((n) => console.log(`[Events] space → ${eventsUrl} (${n} pending)`), () => {});
    return outbox;
}

const subjectRef = (sub) => (sub && /^usr_[0-9A-HJKMNP-TV-Z]{26}$/.test(sub) ? { type: 'user', id: sub } : (sub && /^gst_/.test(sub) ? { type: 'guest', id: sub } : null));

/**
 * Queue one event. MUST run inside the transaction that makes the change; throws if the insert fails,
 * so the change rolls back with it. A no-op (null) while publishing is off.
 */
async function record(eventType, subject, payload, { isPublic = false, actor = null } = {}) {
    if (!outbox) return null;
    const env = await outbox.enqueue(outboxDb, {
        event_type: eventType,
        actor: actor || { type: 'service', id: 'space' },
        subject,
        visibility: isPublic ? 'public' : 'internal',
        priority: 'low',
        payload,
    });
    stats.queued++;
    outboxDb.afterCommit(() => outbox && outbox.kick());
    return env;
}

// ── Builders (read the row as it is after the change) ─────────────────────────────
const actorOf = (sub) => { const r = subjectRef(sub); return r ? { type: r.type, id: r.id } : null; };

// A thread or post is public only in a public space and outside a members-only thread (staff spaces count as members).
const forumVisibility = (thread, spaceVisibility) => (thread.members_only_owner || spaceVisibility !== 'public' ? 'members' : 'public');
async function threadCreated(thread, spaceSlug, spaceVisibility = 'public') {
    const visibility = forumVisibility(thread, spaceVisibility);
    return await record('space.thread.created', { type: 'thread', id: String(thread.id) }, {
        thread_id: Number(thread.id), space: spaceSlug, author: subjectRef(thread.author_subject), visibility,
        url: visibility === 'public' ? `${config.baseUrl}/s/${encodeURIComponent(spaceSlug)}/t/${encodeURIComponent(thread.slug)}` : null,
    }, { isPublic: visibility === 'public', actor: actorOf(thread.author_subject) });
}
async function postCreated(post, thread, spaceSlug, spaceVisibility = 'public') {
    const visibility = forumVisibility(thread, spaceVisibility);
    return await record('space.post.created', { type: 'post', id: String(post.id) }, {
        post_id: Number(post.id), thread_id: Number(thread.id), space: spaceSlug, author: subjectRef(post.author_subject), visibility,
        url: visibility === 'public' ? `${config.baseUrl}/s/${encodeURIComponent(spaceSlug)}/t/${encodeURIComponent(thread.slug)}#p${post.id}` : null,
    }, { isPublic: visibility === 'public', actor: actorOf(post.author_subject) });
}

/**
 * A staff action on someone else's content: space.moderation.action, for the network's moderation
 * audit log (ADR-022). Call inside the same transaction as the change. Never the content.
 */
async function moderationAction(v, action, target, { reason = null, details = {} } = {}) {
    const actorSubject = v && v.subject ? v.subject : null;
    const t = { type: target.type, id: String(target.id).slice(0, 200), ...(target.owner_subject !== undefined ? { owner_subject: target.owner_subject || null } : {}) };
    return await record('space.moderation.action', { type: 'moderation_action', id: `${t.type}:${t.id}`.slice(0, 200) },
        { action, target: t, actor_subject: actorSubject, reason: reason ? String(reason).slice(0, 500) : null, details: details || {} },
        { actor: actorOf(actorSubject) || (v && v.service ? { type: 'service', id: String(v.service) } : null) });
}

/** Synchronous: whether the relay is on, and what this process queued. */
function status() {
    if (!outbox) return { enabled: false };
    return { enabled: true, queued_since_boot: stats.queued, last_error: stats.lastError };
}
/** status() with the outbox's backlog (rows not sent yet, rows Events refused). */
async function backlog() {
    if (!outbox) return { enabled: false };
    return { ...status(), pending: await outbox.pending(), rejected: await outbox.rejected() };
}
/**
 * Graceful stop (server/index.js): no further sends; resolves when the send in progress has finished.
 * Rows written after this (a request that was still finishing) stay in the outbox for the next start.
 */
function stop() {
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = null;
    return outbox ? outbox.stop() : Promise.resolve();
}
function _reset() { if (outbox) outbox.stop(); outbox = null; outboxDb = null; stats.queued = 0; stats.lastError = null; }

module.exports = { init, record, moderationAction, threadCreated, postCreated, status, backlog, stop, _reset };
