'use strict';
/**
 * A space from a page (plan §AD.15: "point at any OpenVibe page (a stream, a Rundown episode, a Compare table) and get a
 * space that tracks it"): /spaces/new?page=<an OpenVibe address> writes the new space's description from what the page
 * is (a channel follows its streams through events.json; a Rundown topic, a comparison, any other page), ready to build;
 * an address off OpenVibe, plain http or a look-alike host writes nothing.
 *   node test/space-from-page.test.js
 */
const assert = require('assert');
const { boot, check, done } = require('./stageb/boot');
const { describe } = require('../server/spaces/from-page');

(async () => {
    await check('what the page is becomes the description', () => {
        const ch = describe('https://openvibe.live/@maticus');
        assert.strictEqual(ch.kind, 'channel');
        assert.match(ch.prompt, /maticus's channel on OpenVibe\.Live[\s\S]*live\.stream\.started and live\.stream\.ended/);
        assert.strictEqual(describe('https://openvibe.live/rundown/car-seat-patience').kind, 'rundown');
        assert.match(describe('https://openvibe.compare/gpu-rent').prompt, /comparison "gpu rent" on OpenVibe\.Compare/);
        assert.strictEqual(describe('https://openvibe.wiki/Streaming').kind, 'page');
        assert.strictEqual(describe('https://openvibe.live/rundown').kind, 'rundown', 'the Rundown itself, not a channel called rundown');
        for (const off of ['https://evil.example/x', 'http://openvibe.live/@a', 'https://openvibe.live.evil.com/@a', 'https://user:pw@openvibe.live/@a', 'javascript:alert(1)', '']) {
            assert.strictEqual(describe(off), null, `nothing from ${off}`);
        }
        assert.doesNotMatch(describe('https://openvibe.wiki/%3Cscript%3E').prompt, /<script>/, 'no markup from the address');
    });

    const t = await boot();
    const alice = t.user('alice');
    try {
        await check('the new-space page arrives with that description in its box', async () => {
            const r = await t.api('GET', `/spaces/new?page=${encodeURIComponent('https://openvibe.live/@maticus')}`, { session: alice });
            assert.strictEqual(r.status, 200);
            assert.match(r.text, /<textarea id="sp-prompt" name="prompt"[^>]*>A space that keeps up with maticus&#39;s channel|<textarea id="sp-prompt" name="prompt"[^>]*>A space that keeps up with maticus's channel/);
            const off = await t.api('GET', `/spaces/new?page=${encodeURIComponent('https://evil.example/x')}&prompt=${encodeURIComponent('a quiz')}`, { session: alice });
            assert.match(off.text, /<textarea id="sp-prompt" name="prompt"[^>]*>a quiz<\/textarea>/, 'off OpenVibe: the words given, nothing from the page');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exit(1); });
