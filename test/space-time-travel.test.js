'use strict';
/**
 * Time travel (plan §AD.15: "scrub a space back to any day and see what it said then"): the editor offers View on every
 * older version; viewing hands the preview that version's files and when it was made, and changes nothing; only the
 * maker can look.
 *   node test/space-time-travel.test.js
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
        await check('View hands the preview an older version\'s files, and nothing changes', async () => {
            const r = await form(alice, '/spaces/new', { template: 'poll' });
            const slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            const row = await t.ctx.spaces.getBySlug(slug);
            const original = (await t.ctx.spaces.files(row)).map((f) => ({ path: f.path, content: f.content }));
            assert.strictEqual((await edit(alice, 'PUT', `/spaces/${slug}/files`, { files: [...original, { path: 'later.txt', content: 'later' }] })).status, 200);
            const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
            assert.match(page.text, /<li data-n="2"[^>]*><b>#2<\/b>[\s\S]*?<span class="sp-muted">now<\/span>/, 'the newest is now');
            assert.match(page.text, /<li data-n="1" data-at="[^"]+" data-who="created"><b>#1<\/b>[\s\S]*?data-view="1">View<\/button>/, 'an older one has View');
            const v = await edit(alice, 'POST', `/spaces/${slug}/versions/1/view`);
            assert.strictEqual(v.status, 200);
            const j = JSON.parse(v.text);
            assert.strictEqual(j.n, 1);
            assert.strictEqual(j.source, 'created');
            assert.ok(/^\d{4}-\d\d-\d\dT/.test(j.at));
            assert.deepStrictEqual(j.files.map((f) => f.path).sort(), original.map((f) => f.path).sort(), 'as it was then');
            assert.ok((await t.ctx.spaces.files(row)).some((f) => f.path === 'later.txt'), 'nothing changed');
            assert.strictEqual((await edit(bob, 'POST', `/spaces/${slug}/versions/1/view`)).status, 404, 'only the maker');
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/versions/9/view`)).status, 404);
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
