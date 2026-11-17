'use strict';
/**
 * Every change is a version you can see, compare and undo (plan §AD.15): making a space and each save that changes its
 * files keep a version (a save that changes nothing keeps none); the editor lists them with who or what made each and
 * which files it changed; Restore undoes to one, as a new version; only the maker can; the last 20 are kept.
 *   node test/space-versions.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');

const ORIGIN = 'https://openvibe.space';

(async () => {
    const t = await boot();
    const { csrfToken } = require('../server/auth/forms');
    const alice = t.user('alice'), bob = t.user('bob');
    const csrf = (u) => csrfToken(t.config, { subject: u.subject });
    const form = (u, path, fields) => t.api('POST', path, { session: u, form: { csrf: csrf(u), ...fields }, headers: { origin: ORIGIN } });
    const edit = (u, method, path, json) => t.api(method, path, { session: u, json, headers: { origin: ORIGIN, 'x-csrf-token': csrf(u) } });
    try {
        let slug, row, original;
        await check('making a space and each real change keep a version; a save that changes nothing keeps none', async () => {
            const r = await form(alice, '/spaces/new', { template: 'trivia' });
            slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            row = await t.ctx.spaces.getBySlug(slug);
            original = await t.ctx.spaces.files(row);
            let v = await t.ctx.spaces.versions(row);
            assert.deepStrictEqual(v.map((x) => [x.n, x.source]), [[1, 'created']]);
            const index = original.find((f) => f.path === 'index.html');
            const changed = [...original.filter((f) => f.path !== 'index.html'), { path: 'index.html', content: index.content.replace('</body>', '<p>new line</p></body>') }, { path: 'notes.txt', content: 'hi' }];
            assert.strictEqual((await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: changed })).status, 200);
            assert.strictEqual((await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: changed })).status, 200, 'saved again, unchanged');
            v = await t.ctx.spaces.versions(row);
            assert.deepStrictEqual(v.map((x) => [x.n, x.source]), [[2, 'editor'], [1, 'created']], 'the unchanged save kept none');
            assert.deepStrictEqual(v[0].changes, { added: ['notes.txt'], changed: ['index.html'], removed: [] }, 'what it changed');
            assert.strictEqual(v[0].by, 'alice');
        });

        await check('the editor lists them; Restore undoes to one as a new version; only the maker can', async () => {
            const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
            assert.match(page.text, /<details class="sp-ed-fnlog sp-ed-versions" id="ed-versions">/);
            assert.match(page.text, /<b>#2<\/b><span>saved · alice<\/span>[\s\S]*?<span class="sp-muted">now<\/span>[\s\S]*?<code>\+ notes\.txt  ~ index\.html<\/code>/);
            assert.match(page.text, /data-restore="1"/);
            assert.strictEqual((await edit(bob, 'POST', `/spaces/${slug}/versions/1/restore`)).status, 404, 'another person sees no such space');
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/versions/9/restore`)).status, 404);
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/versions/1/restore`)).status, 200);
            const now = await t.ctx.spaces.files(row);
            assert.deepStrictEqual(now.map((f) => [f.path, f.content]).sort(), original.map((f) => [f.path, f.content]).sort(), 'the files are version 1\'s again');
            const v = await t.ctx.spaces.versions(row);
            assert.deepStrictEqual([v[0].n, v[0].source, v[0].note], [3, 'restore', 'back to version 1']);
            assert.deepStrictEqual(v[0].changes, { added: [], changed: ['index.html'], removed: ['notes.txt'] });
        });

        await check('the last 20 are kept', async () => {
            for (let i = 0; i < 25; i++) await t.ctx.spaces.saveFiles({ kind: 'user', subject: t.user('alice').subject, user: { username: 'alice' } }, row, [...original, { path: 'n.txt', content: String(i) }]);
            const v = await t.ctx.spaces.versions(row, 50);
            assert.strictEqual(v.length, 20);
            assert.strictEqual(v[0].n, 28);
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
