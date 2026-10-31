'use strict';

/**
 * Space → OpenVibe.Events through the openvibe-sdk service outbox (ADR-004).
 *
 *   space.deploy.created    an upload became an immutable, ready deploy
 *   space.deploy.activated  a site's active deploy changed (payload.rollback marks a rollback)
 *   space.deploy.failed     an upload was refused (payload.code, problem codes; no file contents)
 *   space.domain.verified   a custom domain's TXT record was found; the domain is now served
 *   space.app.claimed       a guest draft was claimed by a signed-in person (it is theirs now)
 *
 * The SDK writes each row inside the change's own transaction (emit joins the ambient openvibe-sdk/db
 * transaction), so an event exists if and only if its change committed. The relay publishes with
 * Space's service token (events.event.publish, audience openvibe.events) only when EVENTS_URL and
 * OV_OAUTH_CLIENT_SECRET are set; otherwise rows wait in event_outbox and /api/ready reports the
 * relay as off. The undeclared event types below are refused by emit().
 */
const { createServiceOutbox } = require('openvibe-sdk/events');

const EVENT_TYPES = Object.freeze(['space.deploy.created', 'space.deploy.activated', 'space.deploy.failed', 'space.domain.verified', 'space.app.claimed']);

function createHostOutbox({ db, config, fetchImpl, now, log = console }) {
    return createServiceOutbox({
        db,
        source: 'space',
        eventsUrl: config.events.url,
        networkInternalUrl: config.networkInternalUrl,
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        intervalMs: config.events.intervalMs,
        now,
        log,
        eventTypes: EVENT_TYPES,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
}

module.exports = { createHostOutbox, EVENT_TYPES };
