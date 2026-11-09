'use strict';
/**
 * The AI builder's component vocabulary: OpenVibe.Design's public design.component@1 registry is read once and cached,
 * a failed read never fails a build, and an injected AI client (every other test) makes no network call at all.
 */
const assert = require('assert');
const http = require('http');
const { registryVocabulary, createSpacesAi } = require('../server/spaces/ai');

const LISTEN = (handler) => new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
    }));
});

const configFor = (url) => ({ spaces: { ai: { enabled: true, url: 'http://127.0.0.1:1', designUrl: url } }, oauth: { clientSecret: 'x' } });
const quiet = { warn: () => {} };

(async () => {
    let hits = 0;
    const server = await LISTEN((req, res) => {
        hits++;
        assert.strictEqual(req.url, '/api/v1/components');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ schema: 'design.component@1', components: [
            { name: 'sheet', summary: 'A modal task surface.', states: ['closed', 'open'], tokens: ['color.bg.raised'], platforms: { web: { markup: 'kit.sheet()' }, android: { material3: 'SurfaceContainerHigh' }, ios: { specification: '.sheet' } } },
            { name: 'ai-choice', summary: 'The selected model.', states: ['default'], tokens: ['color.accent.base'], platforms: { web: { markup: '.ov-ai-choice' }, android: { material3: 'AssistChip' }, ios: { specification: 'Menu' } } },
        ] }));
    });
    const text = await registryVocabulary(configFor(server.url), { log: quiet });
    assert.match(text, /^sheet — A modal task surface\./);
    assert.match(text, /Android: SurfaceContainerHigh/);
    assert.match(text, /ai-choice/);
    assert.strictEqual(hits, 1, 'one read');
    await registryVocabulary(configFor(server.url), { log: quiet });
    assert.strictEqual(hits, 1, 'the second build uses the cache');
    await server.close();

    const bad = await LISTEN((req, res) => { res.writeHead(503); res.end('no'); });
    const warnings = [];
    assert.strictEqual(await registryVocabulary(configFor(bad.url), { log: { warn: (m) => warnings.push(m) } }), '', 'a failed registry is no vocabulary');
    assert.ok(warnings.length && /503/.test(warnings[0]));
    await bad.close();

    let fetched = 0;
    const calls = [];
    const fake = { runs: { create: async (workflow, input) => { calls.push({ workflow, input }); return { run: { id: 'run-1' } }; } } };
    const ai = createSpacesAi({ config: configFor('http://127.0.0.1:1'), client: fake, log: quiet });
    const originalFetch = global.fetch;
    global.fetch = async () => { fetched++; throw new Error('must not fetch'); };
    assert.strictEqual(await ai.build({ subject: 'usr_1' }, { prompt: 'A pizza poll' }), 'run-1');
    global.fetch = originalFetch;
    assert.strictEqual(fetched, 0, 'an injected AI client makes no registry call');
    assert.deepStrictEqual(Object.keys(calls[0].input).includes('components'), false);
    assert.strictEqual(calls[0].workflow, 'space.app.build');

    console.log('  ok  the builder reads design.component@1, caches it, and an injected client never fetches');
})().catch((e) => { console.error('  FAIL', e); process.exit(1); });
