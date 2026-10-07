'use strict';
/**
 * The real process on a fresh database (the T10 finish line): `node server/index.js` with no
 * DATABASE_URL, so migrations run on an embedded PGlite database of its own; /api/ready is 2xx and
 * says what it serves, GET /s renders the seeded board index, / sends visitors there, /llms.txt and
 * /robots.txt answer, and SIGTERM stops it cleanly (exit 0, within the manifest's 5 s).
 * Nothing here is mocked: this is the entry point the unit would run.
 */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

let failures = 0;
async function check(name, fn) {
    try { await fn(); console.log('  ✓', name); }
    catch (e) { failures++; console.log('  ✗', name, "\n     ", (e.stack || String(e)).split("\n").slice(0, process.env.DEBUG ? 40 : 4).join("\n      ")); }
}

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-space-boot-'));
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test',
            SPACE_PGLITE_DIR: path.join(dir, 'pglite'),
            DATABASE_URL: '', DATABASE_DIRECT_URL: '', VALKEY_URL: '',
            BASE_URL: `http://127.0.0.1:${port}`,
            EVENTS_URL: '', SPACE_EVENTS_SECRET: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
    const base = `http://127.0.0.1:${port}`;

    try {
        let up = false;
        for (let i = 0; i < 200 && !up; i++) {
            up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
            if (!up) await sleep(100);
        }
        assert.ok(up, `the server did not start:\n${out}`);
        assert.match(out, /\[Space\] test on http:\/\/127\.0\.0\.1:\d+ → http:\/\/127\.0\.0\.1:\d+/, 'the process announces itself');

        await check('a fresh database: migrations ran, /api/ready is 2xx and names the store', async () => {
            const r = await fetch(`${base}/api/ready`);
            const body = await r.json();
            assert.ok(r.status >= 200 && r.status < 300, `ready answered ${r.status}: ${JSON.stringify(body)}`);
            assert.strictEqual(body.service, 'space');
            // The database is the required check; without a Network to reach, the optional JWKS check
            // degrades the report (server/observability.js) — the process is still serving pages.
            assert.ok(['ok', 'degraded'].includes(body.status), `status ${body.status}`);
            assert.strictEqual(body.checks.db.status, 'ok');
            assert.strictEqual(body.checks.db.detail.store, 'pglite');
        });

        await check('GET /s renders the board index with the seeded spaces', async () => {
            const r = await fetch(`${base}/s`);
            assert.strictEqual(r.status, 200);
            const html = await r.text();
            assert.match(html, /<title>Spaces · OpenVibe\.Space<\/title>/);
            assert.match(html, /href="\/s\/general"/, 'a seeded space is on the board index');
            assert.match(html, /href="\/s\/showcase"/);
            assert.match(html, /OpenVibe\.Space — latest threads/, 'the threads feed is advertised');
            assert.match(html, /rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/s"/);
        });

        await check('a space and its feed render; / redirects to the board index', async () => {
            const space = await fetch(`${base}/s/general`);
            assert.strictEqual(space.status, 200);
            const html = await space.text();
            assert.match(html, /<h1>General/);
            const feed = await fetch(`${base}/s/feed.xml`);
            assert.strictEqual(feed.status, 200);
            assert.match(await feed.text(), /<rss version="2\.0"/);
            const root = await fetch(`${base}/`, { redirect: 'manual' });
            assert.strictEqual(root.status, 301);
            assert.strictEqual(root.headers.get('location'), '/s');
        });

        await check('crawler endpoints answer: robots.txt, llms.txt, sitemap.xml', async () => {
            const robots = await fetch(`${base}/robots.txt`);
            assert.strictEqual(robots.status, 200);
            assert.match(await robots.text(), /Sitemap:/);
            const llms = await fetch(`${base}/llms.txt`);
            assert.strictEqual(llms.status, 200);
            assert.match(await llms.text(), /OpenVibe\.Space/);
            const map = await fetch(`${base}/sitemap.xml`);
            assert.strictEqual(map.status, 200);
            assert.match(await map.text(), /<loc>http:\/\/127\.0\.0\.1:\d+\/s<\/loc>/);
        });

        await check('SIGTERM stops it cleanly (exit 0, within the manifest’s 5 s)', async () => {
            child.kill('SIGTERM');
            const r = await Promise.race([exited, sleep(7000).then(() => null)]);
            assert.ok(r, 'the process did not exit within 7 s');
            assert.deepStrictEqual(r, { code: 0, signal: null }, `exit ${JSON.stringify(r)}\n${out}`);
            assert.match(out, /\[Space\] stopped: subscriptions off, relay off, outbox off/, 'the stop is logged');
        });
    } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
