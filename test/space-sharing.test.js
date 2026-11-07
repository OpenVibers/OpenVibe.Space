'use strict';
/**
 * Sharing on Space apps (design 2026-11-06, VISIBILITY-EVERYWHERE step 4; openvibe-sdk/share).
 * A draft space is Only me; its maker can name people ("look at this before I publish it").
 * Publishing makes it Everyone (or the link); unpublishing takes it back to Only me.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/app');

(async () => {
    const h = await boot();
    const alice = h.network.addUser({ network_user_id: 21, username: 'alice' });
    const bob = h.network.addUser({ network_user_id: 22, username: 'bob' });
    const sam = h.network.addUser({ network_user_id: 23, username: 'sam' });
    const tok = (u) => h.network.sign({ id: u.network_user_id, subject_id: u.subject_id, username: u.username, display_name: u.display_name, role: 'user', aud: ['openvibe.network', 'openvibe.space'] });
    const spaces = h.app.locals.hosting.spaces;
    const sharing = h.app.locals.hosting.sharing;
    const viewer = (u) => ({ kind: 'user', subject: u.subject_id, user: { username: u.username, display_name: u.display_name } });
    const get = (path, u, opts = {}) => h.get(path, { ...opts, ...(u ? { cookies: [`ov_token=${tok(u)}`] } : {}) });
    const share = (id, opts = {}) => h.get(`/api/v1/space/${id}/share`, { headers: { 'x-requested-with': 'ov-share', ...(opts.headers || {}) }, ...opts });
    const putShare = (id, u, body) => share(id, { method: 'PUT', headers: { authorization: `Bearer ${tok(u)}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const row = async (id) => await h.db.prepare('SELECT * FROM shares WHERE service = ? AND kind = ? AND resource_id = ?').get('space', 'space', id);

    const make = async () => await spaces.create(viewer(alice), { name: 'Secret plan', description: 'SECRET-PLAN', files: [{ path: 'index.html', content: '<h1>SECRET-PLAN</h1>' }] });

    await check('a new space is registered Only me, owned by its maker; nobody else opens the draft', async () => {
        const space = await make();
        const s = await row(space.id);
        assert.strictEqual(s.audience, 'private');
        assert.deepStrictEqual(s.owner_subject, { type: 'user', id: alice.subject_id });
        assert.strictEqual((await get(`/spaces/${space.slug}`, alice)).status, 200);
        assert.strictEqual((await get(`/spaces/${space.slug}`, bob)).status, 404);
        assert.strictEqual((await get(`/spaces/${space.slug}`)).status, 404);
    });

    await check('Specific people: the named person opens the draft; a stranger gets the gate and no name', async () => {
        const space = await make();
        const put = await putShare(space.id, alice, { audience: 'people', members: [{ subject: { type: 'user', id: bob.subject_id }, role: 'viewer' }] });
        assert.strictEqual(put.status, 200, put.text);
        assert.strictEqual(put.json().audience, 'people');
        const member = await get(`/spaces/${space.slug}`, bob);
        assert.strictEqual(member.status, 200);
        assert.ok(member.text.includes('Secret plan'));
        const stranger = await get(`/spaces/${space.slug}`, sam);
        assert.strictEqual(stranger.status, 404);
        assert.ok(stranger.text.includes('shared with specific people') && stranger.text.includes('data-ov-share-gate'));
        assert.ok(!stranger.text.includes('SECRET-PLAN'), 'no description or files');
        const anon = await get(`/spaces/${space.slug}`);
        assert.strictEqual(anon.status, 404);
        assert.ok(anon.text.includes('/auth/login?next='));
        assert.strictEqual((await share(space.id, { headers: { authorization: `Bearer ${tok(sam)}` } })).status, 404, 'the sheet is the owner’s');
    });

    await check('Everyone and the link open a draft by its address; the gallery still shows only published, public spaces', async () => {
        const space = await make();
        assert.strictEqual((await putShare(space.id, alice, { audience: 'public' })).status, 200);
        assert.strictEqual((await get(`/spaces/${space.slug}`)).status, 200);
        assert.strictEqual((await putShare(space.id, alice, { audience: 'link' })).status, 200);
        assert.strictEqual((await get(`/spaces/${space.slug}`)).status, 200, 'the link is the key');
        const gallery = await get('/spaces');
        assert.ok(!gallery.text.includes('Secret plan'), 'a draft is never in the gallery');
    });

    await check('unpublishing returns a space to Only me, and the row follows the gallery visibility', async () => {
        const space = await make();
        // A space can only be published by staff in this build; flip the row as publishing would, then unpublish.
        await h.db.prepare('UPDATE space_apps SET published_at = ?, visibility = ? WHERE id = ?').run(Date.now(), 'public', space.id);
        await h.db.prepare('UPDATE space_apps SET site_id = ? WHERE id = ?').run('sit_01J8ZQ4Y7N3M2K1H0G9F8E7D6C', space.id);
        await sharing.syncAudience(space.id, 'public');
        assert.strictEqual((await row(space.id)).audience, 'public');
        assert.strictEqual((await get(`/spaces/${space.slug}`)).status, 200);
        await h.db.prepare('UPDATE space_apps SET site_id = NULL, published_at = NULL WHERE id = ?').run(space.id);
        await sharing.syncAudience(space.id, 'private');
        assert.strictEqual((await row(space.id)).audience, 'private');
        assert.strictEqual((await get(`/spaces/${space.slug}`)).status, 404);
    });

    await check('the sheet on a published space offers Everyone and the link; a draft offers people and Only me', async () => {
        const draft = await make();
        const d = await share(draft.id, { headers: { authorization: `Bearer ${tok(alice)}` } });
        assert.strictEqual(d.status, 200, d.text);
        assert.deepStrictEqual(d.json().audiences, ['people', 'private']);
        await h.db.prepare('UPDATE space_apps SET site_id = ? WHERE id = ?').run('sit_01J8ZQ4Y7N3M2K1H0G9F8E7D6C', draft.id);
        const p = await share(draft.id, { headers: { authorization: `Bearer ${tok(alice)}` } });
        assert.deepStrictEqual(p.json().audiences, ['public', 'link']);
    });

    await done();
    await h.close();
})();
