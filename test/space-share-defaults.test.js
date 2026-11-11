'use strict';
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');
const { csrfToken } = require('../server/auth/forms');

(async () => {
    const t = await boot();
    const alice = t.user('alice');
    const bob = t.user('bob');
    const viewer = (user) => ({ kind: 'user', subject: user.subject, user: { username: user.username } });
    const make = (user, name) => t.ctx.spaces.create(viewer(user), {
        name, files: [{ path: 'index.html', content: '<h1>Draft</h1>' }],
    });
    const post = (user, fields) => t.api('POST', '/spaces/mine/share-default', {
        session: user, form: { csrf: csrfToken(t.config, { subject: user.subject }), ...fields },
        headers: { origin: 'https://openvibe.space' },
    });
    try {
        await check('published audience default is saved on Your spaces; drafts remain Only me', async () => {
            const page = await t.api('GET', '/spaces/mine', { session: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('Apply to all my published spaces'));
            assert.strictEqual(await t.ctx.sharing.defaultAudience(alice.subject), 'public');
            const saved = await post(alice, { audience: 'link' });
            assert.strictEqual(saved.status, 303, saved.text);
            assert.strictEqual(await t.ctx.sharing.defaultAudience(alice.subject), 'link');
            const draft = await make(alice, 'Link by default');
            assert.strictEqual(draft.visibility, 'unlisted');
            assert.strictEqual((await t.ctx.sharing.shareOf(draft.id)).audience, 'private');
            const override = await t.ctx.spaces.updateSettings(viewer(alice), draft, { visibility: 'public' });
            assert.strictEqual(override.visibility, 'public');
            const other = await make(bob, 'Bob default');
            assert.strictEqual(other.visibility, 'public');
        });

        await check('apply to all changes only this person’s published spaces, not drafts', async () => {
            const aliceLive = await make(alice, 'Alice published');
            const aliceDraft = await make(alice, 'Alice draft');
            const bobLive = await make(bob, 'Bob published');
            await t.ctx.store.db.exec('UPDATE space_apps SET site_id = $1 WHERE id = $2', ['sit_01J8ZQ4Y7N3M2K1H0G9F8E7D6C', aliceLive.id]);
            await t.ctx.store.db.exec('UPDATE space_apps SET site_id = $1 WHERE id = $2', ['sit_01J8ZQ4Y7N3M2K1H0G9F8E7D6D', bobLive.id]);
            await t.ctx.sharing.syncAudience(aliceLive.id, 'public');
            await t.ctx.sharing.syncAudience(bobLive.id, 'public');
            const applied = await post(alice, { audience: 'link', apply: '1' });
            assert.strictEqual(applied.status, 303, applied.text);
            assert.strictEqual((await t.ctx.sharing.shareOf(aliceLive.id)).audience, 'link');
            assert.strictEqual((await t.ctx.store.db.maybe('SELECT visibility FROM space_apps WHERE id = $1', [aliceLive.id])).visibility, 'unlisted');
            assert.strictEqual((await t.ctx.sharing.shareOf(aliceDraft.id)).audience, 'private');
            assert.strictEqual((await t.ctx.sharing.shareOf(bobLive.id)).audience, 'public');
            assert.strictEqual((await t.ctx.store.db.maybe('SELECT visibility FROM space_apps WHERE id = $1', [bobLive.id])).visibility, 'public');
        });

        await check('cross-site and invalid audience changes are refused', async () => {
            assert.strictEqual((await t.api('POST', '/spaces/mine/share-default', {
                session: alice, form: { csrf: csrfToken(t.config, { subject: alice.subject }), audience: 'public' },
                headers: { origin: 'https://elsewhere.example' },
            })).status, 403);
            assert.strictEqual((await post(alice, { audience: 'private' })).status, 422);
            assert.strictEqual(await t.ctx.sharing.defaultAudience(alice.subject), 'link');
        });
    } finally { await t.close(); }
    done();
})().catch((error) => { console.error(error); process.exit(1); });
