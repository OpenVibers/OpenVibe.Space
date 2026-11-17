'use strict';
/**
 * Memory you can see (plan §AD.15: "a space's memory is a page of facts … editable and forgettable"): what a space
 * keeps (ov.store) shows in its maker's editor with when each fact changed; the maker forgets one, or everything; no one
 * else sees or forgets it, and a visitor's own keys are never shown as the space's.
 *   node test/space-memory.test.js
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
        let slug, row;
        await check('what the space keeps shows in its editor, newest first, with when it changed', async () => {
            const r = await form(alice, '/spaces/new', { template: 'trivia' });
            slug = /^\/spaces\/([^/]+)\/edit$/.exec(r.headers.location)[1];
            row = await t.ctx.spaces.getBySlug(slug);
            const self = { subject: `space:${row.id}`, username: row.slug, name: row.name };
            await t.ctx.spaceData.kvSet(row, self, 'count', 3);
            t.clock.advance(1000);
            await t.ctx.spaceData.kvSet(row, self, 'last', { who: 'ada', at: 1 });
            await t.ctx.spaceData.kvSet(row, { subject: 'usr_visitor', username: 'v' }, 'mine', 'a visitor\'s own');
            const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
            assert.strictEqual(page.status, 200);
            assert.match(page.text, /<details class="sp-ed-fnlog sp-ed-memory" id="ed-memory">/);
            assert.match(page.text, /<li><b>last<\/b><code>\{&quot;who&quot;:&quot;ada&quot;,&quot;at&quot;:1\}<\/code>[\s\S]*?<li><b>count<\/b><code>3<\/code>/, 'newest first, values shown escaped');
            assert.doesNotMatch(page.text, /a visitor&#39;s own|a visitor's own/, 'a visitor\'s own keys are not the space\'s');
        });

        await check('the maker forgets one fact, then everything; no one else can', async () => {
            assert.strictEqual((await edit(bob, 'POST', `/spaces/${slug}/memory/forget`, { key: 'count' })).status, 404, 'another person sees no such space');
            const one = await edit(alice, 'POST', `/spaces/${slug}/memory/forget`, { key: 'count' });
            assert.strictEqual(one.status, 200);
            assert.deepStrictEqual((await t.ctx.spaceData.memory(row)).map((m) => m.key), ['last']);
            assert.strictEqual((await edit(alice, 'POST', `/spaces/${slug}/memory/forget`, { all: true })).status, 200);
            assert.deepStrictEqual(await t.ctx.spaceData.memory(row), []);
            assert.strictEqual(await t.ctx.spaceData.kvGet(row, { subject: 'usr_visitor' }, 'mine'), 'a visitor\'s own', 'and a visitor\'s own stays theirs');
            const page = await t.api('GET', `/spaces/${slug}/edit`, { session: alice });
            assert.doesNotMatch(page.text, /id="ed-memory"/, 'nothing kept: no Memory section');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
