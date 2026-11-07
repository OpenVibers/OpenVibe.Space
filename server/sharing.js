'use strict';

/**
 * Sharing for Space apps (design 2026-11-06, VISIBILITY-EVERYWHERE step 4; openvibe-sdk/share).
 *
 * The SDK owns the model and the rules: the `shares` row next to each space, the one access check
 * (canView), members, access requests, transfers, the append-only log and the delivery queue. This
 * file is the wiring a service supplies:
 *
 *   - network.json       Network's identity lookups (@name → subject, and a person's card for the sheet)
 *   - events.publish     Space's own Events outbox, so share.* envelopes go out with every other space.* event
 *   - notify             Network's notification push; a refusal is logged, never allowed to stall the queue
 *   - onAudienceChange   keeps space_apps.visibility in the gallery's words (public→public, anything narrower→unlisted), so
 *                        the gallery, the sitemap and llms.txt drop it at once
 *   - onOwnerChange      moves space_apps.owner_subject to the new owner
 *
 * A draft space is registered private (Only me). The sheet on it can name people ("look at this
 * before I publish it"); /spaces/:slug is the link, and it answers with the gate, never the space's
 * files, to anyone not on the list. A published space is Everyone; the sheet offers Everyone and
 * Anyone with the link for it (people/private would leave the deployed site up).
 */
const { createShares } = require('openvibe-sdk/share');
const { serviceAuth } = require('openvibe-contracts');

const SERVICE = 'space';
const KIND = 'space';
const AUDIENCES = ['public', 'link', 'people', 'private'];
/** Space's gallery words to the SDK's, and back. Narrower than the gallery is 'unlisted' there. */
const TO_SDK = { public: 'public', unlisted: 'link', private: 'private' };
const FROM_SDK = { public: 'public', link: 'unlisted', people: 'unlisted', private: 'unlisted' };

const refOf = (id) => ({ service: SERVICE, kind: KIND, id: String(id) });

/** Blog's viewer as the SDK wants it: a subject object, and the staff bit. */
function shareViewer(v) {
    if (!v || !v.subject) return null;
    if (String(v.subject).startsWith('usr_')) return { subject: { type: 'user', id: v.subject }, staff: !!v.staff };
    if (String(v.subject).startsWith('gst_')) return { subject: { type: 'guest', id: v.subject }, staff: !!v.staff };
    return null;
}

function createSharing({ db, config, outbox, publication, now = Date.now, fetchImpl = globalThis.fetch, log = console } = {}) {
    const base = String(config.networkInternalUrl || config.networkUrl || '').replace(/\/+$/, '');
    const tokens = config.oauth && config.oauth.clientSecret ? serviceAuth.createTokenClient({
        tokenUrl: `${base}/oauth/token`,
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        audience: 'openvibe.network',
        scope: 'identity.subject.resolve network.notifications.push',
        fetchImpl,
    }) : null;

    async function networkJson({ path, method = 'GET', json, query } = {}) {
        if (!tokens) throw new Error('Network is not configured for this service');
        const url = new URL(`${base}${path}`);
        for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
        const headers = { Accept: 'application/json', ...(await tokens.authHeaders()) };
        if (json !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(url, { method, headers, body: json === undefined ? undefined : JSON.stringify(json), signal: AbortSignal.timeout(8000) });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            const err = new Error(`Network ${method} ${path} ${res.status}: ${(body && (body.detail || body.error)) || 'failed'}`);
            err.status = res.status;
            throw err;
        }
        return body;
    }

    /** One notification, addressed by canonical subject. It never carries a post's title or text. */
    async function notify(n) {
        const to = n && n.to;
        if (!to || to.type !== 'user') return;
        const words = {
            'share.added': ['A space was shared with you', 'Open it on OpenVibe.Space.'],
            'share.access_requested': ['Someone asked for access to your space', 'Review the request on OpenVibe.Space.'],
            'share.transfer.requested': ['Someone wants to give you a space', 'Accept or decline it on OpenVibe.Space.'],
            'share.transfer.answered': ['A space transfer was answered', 'See what happened on OpenVibe.Space.'],
        }[n.kind] || ['Sharing on OpenVibe.Space', 'There is something new for you.'];
        try {
            await networkJson({
                path: '/internal/notifications/push', method: 'POST',
                json: {
                    subject: to.id, type: 'GENERIC', title: words[0], message: words[1],
                    service: 'space', url: n.ref && n.ref.id ? `${config.baseUrl}/spaces/${encodeURIComponent(n.ref.id)}` : config.baseUrl,
                    category: 'social',
                },
            });
        } catch (err) {
            log.warn('[Sharing] notification not sent:', err.message);
        }
    }

    /** The row's audience change keeps the gallery column in step (the gallery, sitemap and llms read it live). */
    async function onAudienceChange(ref, audience, tx) {
        if (ref.service !== SERVICE || ref.kind !== KIND) return;
        const row = await tx.maybe('SELECT visibility FROM space_apps WHERE id = $1', [ref.id]);
        if (!row) return;
        await tx.exec('UPDATE space_apps SET visibility = $1 WHERE id = $2', [FROM_SDK[audience] || 'unlisted', ref.id]);
    }

    async function onOwnerChange(ref, from, to, tx) {
        if (ref.service !== SERVICE || ref.kind !== KIND) return;
        const owner = to && to.type === 'user' ? to.id : null;
        await tx.exec('UPDATE space_apps SET owner_subject = $1 WHERE id = $2', [owner, ref.id]);
    }

    const shares = createShares({
        db,
        network: { json: networkJson },
        events: { publish: async (envelope) => await outbox.emit(envelope) },
        notify,
        onAudienceChange,
        onOwnerChange,
    });

    const sv = (viewer) => shareViewer(viewer);
    const at = (id) => refOf(id);

    return {
        shares,
        SERVICE,
        KIND,
        AUDIENCES,
        refOf,
        shareViewer,
        /** Register a post with the sharing system (inside the post's own transaction). */
        register: async (viewer, id, audience = 'private') => await shares.register(at(id), {
            owner_subject: viewer && viewer.subject ? { type: String(viewer.subject).startsWith('gst_') ? 'guest' : 'user', id: viewer.subject } : { type: 'service', id: SERVICE },
            audience: TO_SDK[audience] || 'private',
        }),
        /**
         * The service's own audience move (a create form, the editor's select, a publish). The caller
         * has already passed access.canWrite and owns the column and the Search sync; this only keeps
         * the share row in step. The SDK's owner check is for people using the sheet.
         */
        syncAudience: async (id, audience) => {
            const next = TO_SDK[audience] || 'private';
            await db.tx(async (t) => {
                const row = await t.maybe('SELECT audience FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3 FOR UPDATE', [SERVICE, KIND, String(id)]);
                if (!row || row.audience === next) return;
                await t.exec('UPDATE shares SET audience = $1, revision = revision + 1 WHERE service = $2 AND kind = $3 AND resource_id = $4', [next, SERVICE, KIND, String(id)]);
            });
        },
        /** A claimed guest draft's share row moves to the person who claimed it (never through the sheet). */
        adopt: async (id, viewer) => await db.exec(`UPDATE shares SET owner_subject = $1::jsonb WHERE service = $2 AND kind = $3 AND resource_id = $4`,
            [JSON.stringify({ type: String(viewer.subject).startsWith('gst_') ? 'guest' : 'user', id: viewer.subject }), SERVICE, KIND, String(id)]),
        shareOf: async (id) => await db.maybe('SELECT * FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3', [SERVICE, KIND, String(id)]),
        canView: async (viewer, id) => await shares.canView(sv(viewer), at(id)),
        canEdit: async (viewer, id) => await shares.canEdit(sv(viewer), at(id)),
        get: async (viewer, id) => await shares.get(sv(viewer), at(id)),
        getWithRevision: async (viewer, id) => await shares.getWithRevision(sv(viewer), at(id)),
        setAudience: async (viewer, id, audience) => await shares.setAudience(sv(viewer), at(id), TO_SDK[audience] || 'private'),
        addMembers: async (viewer, id, list) => await shares.addMembers(sv(viewer), at(id), list),
        removeMember: async (viewer, id, subject) => await shares.removeMember(sv(viewer), at(id), subject),
        update: async (viewer, id, body, opts) => await shares.update(sv(viewer), at(id), body, opts),
        requestAccess: async (viewer, id) => await shares.requestAccess(sv(viewer), at(id)),
        dismiss: async (viewer, id, requestId) => await shares.dismiss(sv(viewer), at(id), requestId),
        transfer: async (viewer, id, input) => await shares.transfer(sv(viewer), at(id), input),
        accept: async (viewer, id, transferId) => await shares.accept(sv(viewer), at(id), transferId),
        decline: async (viewer, id, transferId) => await shares.decline(sv(viewer), at(id), transferId),
        cancel: async (viewer, id, transferId) => await shares.cancel(sv(viewer), at(id), transferId),
        lookup: async (viewer, name) => await shares.lookup(sv(viewer), name),
        sharedWithMe: async (viewer, opts) => await shares.sharedWithMe(sv(viewer), { service: SERVICE, ...(opts || {}) }),
        /** Expire members and transfers, then send queued events and notifications. */
        work: async ({ flush = true } = {}) => {
            let expired = 0;
            try { expired = await shares.expireMembers(); } catch (err) { log.warn('[Sharing] expiry sweep:', err.message); }
            let sent = 0;
            if (flush) { try { sent = await shares.flush(); } catch (err) { log.warn('[Sharing] deliveries:', err.message); } }
            return { expired, sent };
        },
    };
}

/** The uniform API's describe(ref): the sheet shows the post's title and link to its owner. */
function describeRef(db, config) {
    return async (ref) => {
        if (ref.service !== SERVICE || ref.kind !== KIND) return {};
        const space = await db.maybe('SELECT id, slug, name, site_id FROM space_apps WHERE id = $1 AND status = $2', [ref.id, 'active']);
        if (!space) return {};
        return {
            title: space.name || 'Untitled space',
            link: `${String(config.baseUrl || '').replace(/\/+$/, '')}/spaces/${space.slug}`,
            roles: ['viewer'],
            // A published space's site is already up: only Everyone and the link make sense. A draft can name people.
            audiences: space.site_id ? ['public', 'link'] : ['people', 'private'],
            transferable: true,
        };
    };
}

module.exports = { createSharing, describeRef, shareViewer, refOf, AUDIENCES, TO_SDK, FROM_SDK, SERVICE, KIND };
