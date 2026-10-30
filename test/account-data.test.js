'use strict';
/**
 * Account export and deletion (ADR-033) → Space (server/account-data.js). A maker's export carries their spaces with
 * their files; a visitor's carries the list items they added, their private storage and the sign-ins they approved,
 * never a token. Deleting the maker closes their published space's site and Spaces project and removes the space with
 * what others kept in it; deleting the visitor removes their items, storage and sign-ins from other people's spaces.
 * A delivery without the Events signature is refused.
 */
const assert = require('assert');
const crypto = require('crypto');
const { boot, check, done } = require('./stageb/boot');
const { uncovered } = require('openvibe-sdk/account-data');
const { TABLES } = require('../server/account-data');

const ORIGIN = 'https://openvibe.space';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

(async () => {
    const sent = [];
    const accountSend = async (path, body) => { sent.push({ path, body }); return { ok: true, status: 200, json: async () => ({}) }; };
    const t = await boot({ accountSend, env: { SPACE_EVENTS_SECRET: 'events-secret-for-tests-0123456789abcdef' } });
    await check('every table that names a person is covered or exempted with a reason', async () => {
        const missing = await uncovered(t.ctx.store.db, {
            tables: TABLES,
            exempt: {
                account_data_events: 'the ledger of requests itself: which export and deletion Space applied',
                account_data_events_forum: 'the forum ledger of requests itself: which export and deletion the Space forum applied',
            },
        });
        assert.deepStrictEqual(missing, [], `a table with a person column is neither covered nor exempted: ${missing.join(', ')}`);
    });

    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice'), bob = t.user('bob');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    const count = async (sql, args) => Number((await t.ctx.store.db.prepare(sql).get(...args)).n);
    const ev = (id, type, payload) => ({ event_id: id, event_type: type, source: 'network', version: 1, timestamp: new Date().toISOString(), payload });
    const apply = (event) => t.app.locals.accountData.apply(event, { send: accountSend });
    let space, slug, url;

    await check('alice publishes a space; bob signs in to it, adds to its list and keeps something private', async () => {
        const r = await t.api('POST', '/spaces/new', { session: alice, form: { csrf: csrf(alice), template: 'guestbook' }, headers: { origin: ORIGIN } });
        slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
        await edit(alice, 'PUT', `/spaces/${slug}/settings`, { capabilities: ['profile', 'data', 'kv'] });
        url = (await edit(alice, 'POST', `/spaces/${slug}/publish`)).json().url;
        space = await t.ctx.spaces.getBySlug(slug);
        await edit(alice, 'POST', `/spaces/${slug}/preview`, { op: 'items.add', args: { collection: 'notes', value: { text: 'welcome' } } });
        const verifier = b64url(crypto.randomBytes(32));
        const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
        const c = await t.api('POST', `/spaces/${slug}/connect`, { session: bob, form: { csrf: csrf(bob), challenge, state: 'state-bob', return: '/', decision: 'allow' }, headers: { origin: ORIGIN } });
        const code = /#ov_code=([^&]+)/.exec(c.headers.location)[1];
        const token = (await t.api('POST', `/api/v1/apps/${space.id}/token`, { json: { code, code_verifier: verifier }, headers: { origin: url } })).json().token;
        const run = (op, args) => t.api('POST', `/api/v1/apps/${space.id}/run`, { json: { op, args }, headers: { origin: url, authorization: `Bearer ${token}` } });
        assert.strictEqual((await run('items.add', { collection: 'notes', value: { text: 'hi from bob' } })).status, 200);
        assert.strictEqual((await run('kv.set', { key: 'draft', value: 'secret plan' })).status, 200);
        assert.strictEqual((await t.get(`${slug}.openvibe.website`, '/')).status, 200);
    });

    await check('bob\'s export: his list item, private storage and sign-in; no token, nothing of alice\'s', async () => {
        assert.strictEqual(await apply(ev('evt_01JZ00000000000000000SE001', 'network.account.export_requested', { export_id: 'exp_01JZ00000000000000000SEX01', subject: bob.subject })), 'exported');
        const part = sent.find((c) => c.path === '/internal/account-exports/exp_01JZ00000000000000000SEX01/parts');
        const files = Object.fromEntries(part.body.files.map((f) => [f.name, f.content]));
        assert.deepStrictEqual(files['space-list-items.json'].map((i) => JSON.parse(i.value).text), ['hi from bob']);
        assert.deepStrictEqual(files['space-private-storage.json'].map((k) => [k.key, JSON.parse(k.value)]), [['draft', 'secret plan']]);
        assert.deepStrictEqual(files['space-sign-ins.json'].map((g) => g.space_id), [space.id]);
        assert.ok(!files['spaces.json'], 'bob made no space');
        assert.ok(!/token_hash|code_hash/.test(JSON.stringify(part.body)), 'no sign-in secret');
        assert.ok(!JSON.stringify(part.body).includes('welcome'), 'nothing alice wrote');
    });

    await check('alice\'s export carries her space with its files and settings', async () => {
        await apply(ev('evt_01JZ00000000000000000SE002', 'network.account.export_requested', { export_id: 'exp_01JZ00000000000000000SEX02', subject: alice.subject }));
        const part = sent.find((c) => c.path === '/internal/account-exports/exp_01JZ00000000000000000SEX02/parts');
        const spaces = part.body.files.find((f) => f.name === 'spaces.json').content;
        assert.deepStrictEqual([spaces.length, spaces[0].slug, spaces[0].published, spaces[0].files.map((f) => f.path)], [1, slug, true, ['index.html']]);
        assert.deepStrictEqual(spaces[0].capabilities, ['profile', 'data', 'kv']);
    });

    await check('deleting bob removes his item, storage and sign-ins from alice\'s space; hers stay; once', async () => {
        const event = ev('evt_01JZ00000000000000000SD001', 'network.account.deleted', { deletion_id: 'del_01JZ00000000000000000SDE01', subject: bob.subject });
        assert.strictEqual(await apply(event), 'erased');
        assert.strictEqual(await count('SELECT count(*) AS n FROM space_app_items WHERE author_subject = ?', [bob.subject]), 0);
        assert.strictEqual(await count('SELECT count(*) AS n FROM space_app_kv WHERE subject = ?', [bob.subject]), 0);
        assert.strictEqual(await count('SELECT count(*) AS n FROM space_app_tokens WHERE subject = ?', [bob.subject]), 0);
        assert.strictEqual(await count('SELECT count(*) AS n FROM space_app_grants WHERE subject = ?', [bob.subject]), 0);
        assert.strictEqual(await count('SELECT count(*) AS n FROM space_app_items WHERE author_subject = ?', [alice.subject]), 1, 'alice\'s note stays');
        const conf = sent.filter((c) => c.path === '/internal/account-deletions/del_01JZ00000000000000000SDE01/confirmations');
        assert.strictEqual(conf.length, 1);
        assert.deepStrictEqual([conf[0].body.erased.space_app_items, conf[0].body.erased.space_app_kv], [1, 1]);
        assert.notStrictEqual(await apply(event), 'erased', 'a redelivery never erases twice');
    });

    await check('deleting alice closes her space\'s site and Spaces project and removes the space', async () => {
        assert.strictEqual(await apply(ev('evt_01JZ00000000000000000SD002', 'network.account.deleted', { deletion_id: 'del_01JZ00000000000000000SDE02', subject: alice.subject })), 'erased');
        assert.strictEqual(await count('SELECT count(*) AS n FROM space_apps WHERE owner_subject = ?', [alice.subject]), 0);
        assert.strictEqual(await count('SELECT count(*) AS n FROM space_app_items WHERE space_id = ?', [space.id]), 0, 'what was kept in it goes with it');
        assert.strictEqual(await count("SELECT count(*) AS n FROM space_sites WHERE id = ? AND status = 'deleted'", [space.site_id]), 1);
        assert.strictEqual(await count("SELECT count(*) AS n FROM space_projects WHERE owner_subject = ? AND status = 'active'", [alice.subject]), 0);
        assert.notStrictEqual((await t.get(`${slug}.openvibe.website`, '/')).status, 200, 'the address stops serving');
        const conf = sent.find((c) => c.path === '/internal/account-deletions/del_01JZ00000000000000000SDE02/confirmations');
        assert.deepStrictEqual([conf.body.erased.space_apps, conf.body.erased.space_projects], [1, 1]);
    });

    await check('a delivery without the Events signature is refused', async () => {
        const r = await t.api('POST', '/internal/events', { json: { event: ev('evt_01JZ00000000000000000SE003', 'network.account.deleted', { deletion_id: 'del_x', subject: alice.subject }), seq: 1 } });
        assert.strictEqual(r.status, 401);
    });

    await t.close();
    done();
})().catch((err) => { console.error(err); process.exit(1); });
