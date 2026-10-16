'use strict';
/**
 * What a space's code can do through the SDK, for one person:
 *
 *   OV.items   shared lists in a space, readable by anyone who can open it; a signed-in visitor adds items, keeps
 *              one item of their own per list (set: a vote, a best score) and removes their own (the maker any).
 *   OV.kv      each signed-in visitor's private storage in a space.
 *   OV.ai.ask  the space's own AI (server/spaces/ai.js), on behalf of the visitor.
 *
 * and the sign-in that connects a visitor to a space: the connect page (server/spaces/pages.js) records what they
 * approved and hands the space a one-time code (two minutes, PKCE S256); the space's page trades it, from its own
 * origin, for a token bound to that space (a day). Only hashes of codes and tokens are stored.
 *
 * run(op, args, ctx) is the one entry point: the app-facing API (server/spaces/api.js) and the editor's preview
 * (the maker, as themselves) both use it, so the rules are the same everywhere.
 */
const crypto = require('crypto');
const { ApiError } = require('../http/errors');

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const CODE_TTL = 2 * 60 * 1000;
const TOKEN_TTL = 24 * 3600 * 1000;
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createSpaceData({ store, config, spaces, ai, now: clock = null }) {
    const { db } = store;
    const limits = config.spaces;
    const now = clock || store.now;
    const q = {
        list: db.prepare(`SELECT id, author_subject, author_username, author_name, value, created_at, updated_at FROM space_app_items
                          WHERE space_id = ? AND collection = ? AND (? = 0 OR id < ?) ORDER BY id DESC LIMIT ?`),
        count: db.prepare('SELECT COUNT(*) AS n FROM space_app_items WHERE space_id = ?'),
        add: db.prepare(`INSERT INTO space_app_items (space_id, collection, author_subject, author_username, author_name, value, mine, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, false, ?, ?) RETURNING id`),
        setMine: db.prepare(`INSERT INTO space_app_items (space_id, collection, author_subject, author_username, author_name, value, mine, created_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?, true, ?, ?)
                             ON CONFLICT (space_id, collection, author_subject) WHERE mine DO UPDATE SET value = excluded.value, author_username = excluded.author_username,
                             author_name = excluded.author_name, updated_at = excluded.updated_at RETURNING id, created_at`),
        item: db.prepare('SELECT * FROM space_app_items WHERE id = ? AND space_id = ? AND collection = ?'),
        removeItem: db.prepare('DELETE FROM space_app_items WHERE id = ?'),
        kvGet: db.prepare('SELECT value FROM space_app_kv WHERE space_id = ? AND subject = ? AND key = ?'),
        kvCount: db.prepare('SELECT COUNT(*) AS n FROM space_app_kv WHERE space_id = ? AND subject = ?'),
        kvSet: db.prepare(`INSERT INTO space_app_kv (space_id, subject, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT (space_id, subject, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
        kvRemove: db.prepare('DELETE FROM space_app_kv WHERE space_id = ? AND subject = ? AND key = ?'),
        grant: db.prepare('SELECT capabilities FROM space_app_grants WHERE space_id = ? AND subject = ?'),
        setGrant: db.prepare(`INSERT INTO space_app_grants (space_id, subject, capabilities, granted_at) VALUES (?, ?, ?, ?)
                              ON CONFLICT (space_id, subject) DO UPDATE SET capabilities = excluded.capabilities, granted_at = excluded.granted_at`),
        addCode: db.prepare(`INSERT INTO space_app_codes (code_hash, space_id, subject, username, display_name, capabilities, challenge, expires_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
        takeCode: db.prepare('DELETE FROM space_app_codes WHERE code_hash = ? RETURNING *'),
        dropCodes: db.prepare('DELETE FROM space_app_codes WHERE expires_at < ?'),
        addToken: db.prepare(`INSERT INTO space_app_tokens (token_hash, space_id, subject, username, display_name, capabilities, created_at, expires_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
        token: db.prepare('SELECT * FROM space_app_tokens WHERE token_hash = ?'),
        dropToken: db.prepare('DELETE FROM space_app_tokens WHERE token_hash = ?'),
        dropTokens: db.prepare('DELETE FROM space_app_tokens WHERE expires_at < ?'),
    };

    // Per person and space, per minute: writes and AI questions (one process serves Space).
    const windows = new Map();
    function throttle(key, max) {
        const t = now();
        const list = (windows.get(key) || []).filter((x) => t - x < 60000);
        if (list.length >= max) throw new ApiError(429, 'quota', 'that is a lot at once; wait a minute and try again');
        list.push(t);
        windows.set(key, list);
        if (windows.size > 5000) for (const [k, v] of windows) if (!v.some((x) => t - x < 60000)) windows.delete(k);
    }

    const checkName = (kind, v) => {
        if (typeof v !== 'string' || !NAME_RE.test(v)) throw new ApiError(422, 'space.invalid_name', `${kind} names are 1-64 characters: letters, digits, ".", "-" and "_"`);
        return v;
    };
    const jsonOf = (value, max) => {
        if (value === undefined) throw new ApiError(422, 'space.value_required', 'a value is required');
        let s;
        try { s = JSON.stringify(value); } catch { throw new ApiError(422, 'space.invalid_value', 'the value must be JSON'); }
        if (Buffer.byteLength(s) > max) throw new ApiError(413, 'space.value_too_large', `a value is at most ${Math.round(max / 1024)} KB`);
        return s;
    };
    const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
    const iso = (ms) => new Date(Number(ms)).toISOString();
    const itemOut = (r, person) => ({
        id: String(r.id), value: parse(r.value), author: { username: r.author_username, display_name: r.author_name || r.author_username },
        created_at: iso(r.created_at), updated_at: iso(r.updated_at || r.created_at), mine: Boolean(person && r.author_subject === person.subject),
    });
    const need = (ctx, cap) => {
        if (!ctx.person) throw new ApiError(401, 'auth.required', 'sign in with OpenVibe to do this (OV.signIn())');
        if (cap && !ctx.owner && !ctx.capabilities.includes(cap)) throw new ApiError(403, 'space.capability', `this space did not ask for "${cap}" when you signed in`);
    };

    // ── Items ──
    async function listItems(space, collection, { limit = 50, before = 0 } = {}, person = null) {
        checkName('collection', collection);
        const lim = Math.min(100, Math.max(1, Number(limit) || 50));
        const b = Math.max(0, Number(before) || 0);
        return (await q.list.all(space.id, collection, b, b, lim)).map((r) => itemOut(r, person));
    }
    async function addItem(space, person, collection, value) {
        checkName('collection', collection);
        const v = jsonOf(value, limits.itemBytes);
        throttle(`w:${space.id}:${person.subject}`, limits.writesPerMinute);
        if ((await q.count.get(space.id)).n >= limits.itemsPerSpace) throw new ApiError(429, 'quota', `this space holds ${limits.itemsPerSpace} items at most`);
        const t = now();
        const r = await q.add.get(space.id, collection, person.subject, person.username, person.name, v, t, t);
        return itemOut({ id: r.id, author_subject: person.subject, author_username: person.username, author_name: person.name, value: v, created_at: t, updated_at: t }, person);
    }
    async function setItem(space, person, collection, value) {
        checkName('collection', collection);
        const v = jsonOf(value, limits.itemBytes);
        throttle(`w:${space.id}:${person.subject}`, limits.writesPerMinute);
        const t = now();
        const r = await q.setMine.get(space.id, collection, person.subject, person.username, person.name, v, t, t);
        return itemOut({ id: r.id, author_subject: person.subject, author_username: person.username, author_name: person.name, value: v, created_at: r.created_at, updated_at: t }, person);
    }
    async function removeItem(space, person, collection, id, owner) {
        checkName('collection', collection);
        const n = Number(id);
        const row = Number.isSafeInteger(n) && n > 0 ? await q.item.get(n, space.id, collection) : null;
        if (!row) throw new ApiError(404, 'space.item_not_found', 'no such item');
        if (row.author_subject !== person.subject && !owner) throw new ApiError(403, 'space.not_author', 'only its author (or the space\'s maker) removes an item');
        await q.removeItem.run(n);
        return { removed: true };
    }

    // ── KV ──
    async function kvGet(space, person, key) {
        const row = await q.kvGet.get(space.id, person.subject, checkName('key', key));
        return row ? parse(row.value) : null;
    }
    async function kvSet(space, person, key, value) {
        checkName('key', key);
        const v = jsonOf(value, limits.kvBytes);
        throttle(`w:${space.id}:${person.subject}`, limits.writesPerMinute);
        if (!(await q.kvGet.get(space.id, person.subject, key)) && (await q.kvCount.get(space.id, person.subject)).n >= limits.kvKeysPerPerson) {
            throw new ApiError(429, 'quota', `a person keeps ${limits.kvKeysPerPerson} keys at most in one space`);
        }
        await q.kvSet.run(space.id, person.subject, key, v, now());
        return true;
    }
    async function kvRemove(space, person, key) { await q.kvRemove.run(space.id, person.subject, checkName('key', key)); return true; }

    // ── AI ──
    async function ask(space, person, args) {
        let message = '';
        let transcript = '';
        if (typeof args === 'string') message = args;
        else if (args && Array.isArray(args.messages)) {
            const msgs = args.messages.slice(-24).filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string');
            const last = msgs.length && msgs[msgs.length - 1].role === 'user' ? msgs.pop() : null;
            if (!last) throw new ApiError(422, 'space.invalid_messages', 'the last message must be the visitor\'s (role "user")');
            message = last.content;
            transcript = msgs.map((m) => `${m.role === 'user' ? 'visitor' : 'ai'}: ${m.content.replace(/\s+/g, ' ').slice(0, 2000)}`).join('\n');
        } else if (args && typeof args.prompt === 'string') message = args.prompt;
        message = String(message || '').trim();
        if (!message) throw new ApiError(422, 'space.message_required', 'ask something');
        throttle(`ai:${space.id}:${person.subject}`, limits.aiAsksPerMinute);
        if (!(await spaces.spend(`ask:${space.id}`, limits.aiAsksPerSpacePerDay))) throw new ApiError(429, 'quota', 'this space has used its OpenVibe AI for today; try again tomorrow');
        return await ai.ask(space, person, { transcript, message: message.slice(0, 4000) });
    }

    /**
     * One SDK operation. ctx: { space, person (null when signed out), capabilities (what the person approved), owner
     * (the maker, or staff: every capability, and may remove any item) }.
     */
    async function run(op, args = {}, ctx) {
        const { space, person } = ctx;
        const a = args && typeof args === 'object' ? args : {};
        switch (op) {
            case 'me': return person ? { username: person.username, display_name: person.name, capabilities: ctx.owner ? spaces.capsOf(space.capabilities) : ctx.capabilities } : null;
            case 'items.list': return await listItems(space, a.collection, { limit: a.limit, before: a.before }, person);
            case 'items.add': need(ctx, 'data'); return await addItem(space, person, a.collection, a.value);
            case 'items.set': need(ctx, 'data'); return await setItem(space, person, a.collection, a.value);
            case 'items.remove': need(ctx, 'data'); return await removeItem(space, person, a.collection, a.id, ctx.owner);
            case 'kv.get': need(ctx, 'kv'); return await kvGet(space, person, a.key);
            case 'kv.set': need(ctx, 'kv'); return await kvSet(space, person, a.key, a.value);
            case 'kv.remove': need(ctx, 'kv'); return await kvRemove(space, person, a.key);
            case 'ai.ask': need(ctx, 'ai'); return { text: await ask(space, person, a.input !== undefined ? a.input : a) };
            default: throw new ApiError(400, 'space.unknown_op', `unknown operation "${String(op).slice(0, 40)}"`);
        }
    }

    // ── Connecting a visitor ──
    async function grantedFor(space, subject) {
        const row = await q.grant.get(space.id, subject);
        return row ? spaces.capsOf(row.capabilities) : null;
    }
    /** The visitor approved the space's capabilities: a one-time code for the space's page. */
    async function approve(space, person, { challenge }) {
        if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new ApiError(400, 'space.invalid_challenge', 'the sign-in link is incomplete; go back to the space and try again');
        const caps = spaces.capsOf(space.capabilities);
        const t = now();
        await q.dropCodes.run(t);
        await q.setGrant.run(space.id, person.subject, JSON.stringify(caps), t);
        const code = b64url(crypto.randomBytes(32));
        await q.addCode.run(sha(code), space.id, person.subject, person.username, person.name, JSON.stringify(caps), challenge, t + CODE_TTL);
        return code;
    }
    /** The space's page trades the code (with its PKCE verifier) for a token bound to the space. */
    async function exchange(space, { code, verifier }) {
        if (typeof code !== 'string' || typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) throw new ApiError(400, 'space.invalid_grant', 'the sign-in code is missing or malformed');
        const row = await q.takeCode.get(sha(code));
        const bad = new ApiError(400, 'space.invalid_grant', 'the sign-in code expired or was already used; sign in again');
        if (!row || row.space_id !== space.id || Number(row.expires_at) < now()) throw bad;
        const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
        if (challenge !== row.challenge) throw bad;
        const token = b64url(crypto.randomBytes(32));
        const t = now();
        await q.dropTokens.run(t);
        await q.addToken.run(sha(token), space.id, row.subject, row.username, row.display_name, row.capabilities, t, t + TOKEN_TTL);
        return { token, expires_in: Math.floor(TOKEN_TTL / 1000), user: { username: row.username, display_name: row.display_name || row.username }, capabilities: spaces.capsOf(row.capabilities) };
    }
    /** A Bearer token → the person it stands for in this space, or null. */
    async function verify(space, bearer) {
        if (typeof bearer !== 'string' || bearer.length < 20 || bearer.length > 100) return null;
        const row = await q.token.get(sha(bearer));
        if (!row || row.space_id !== space.id || Number(row.expires_at) < now()) return null;
        return { person: { subject: row.subject, username: row.username, name: row.display_name || row.username }, capabilities: spaces.capsOf(row.capabilities) };
    }
    async function revoke(bearer) { if (typeof bearer === 'string') await q.dropToken.run(sha(bearer)); }

    return { run, listItems, grantedFor, approve, exchange, verify, revoke, CODE_TTL, TOKEN_TTL };
}

module.exports = { createSpaceData, NAME_RE };
