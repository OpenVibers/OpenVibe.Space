'use strict';
/**
 * Space's own app icon (plan AB.29): the tile with the shared corner scale's round corner, the mark in the heavy
 * form, and the files where Space keeps them — and the tab shows the file this site ships.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { boot, check, done } = require('./helpers/app');
const icons = require('../scripts/build-icons');

const ASSETS = path.join(__dirname, '..', 'public', 'assets');
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

(async () => {
    const t = await boot();

    await check('the icon files are where Space keeps them, and each is the size it should be', async () => {
        for (const name of ['logo.svg', 'logo-72.png', 'logo-192.png', 'logo-512.png', 'logo-maskable-192.png', 'logo-maskable-512.png']) {
            assert.ok(fs.existsSync(path.join(ASSETS, name)), name);
        }
        assert.deepEqual(pngSize(fs.readFileSync(path.join(ASSETS, 'logo-72.png'))), [72, 72]);
        assert.deepEqual(pngSize(fs.readFileSync(path.join(ASSETS, 'logo-192.png'))), [192, 192]);
        assert.deepEqual(pngSize(fs.readFileSync(path.join(ASSETS, 'logo-512.png'))), [512, 512]);
        assert.deepEqual(pngSize(fs.readFileSync(path.join(ASSETS, 'logo-maskable-192.png'))), [192, 192]);
        assert.deepEqual(pngSize(fs.readFileSync(path.join(ASSETS, 'logo-maskable-512.png'))), [512, 512]);
    });

    await check('the tile carries the round corner of the shared scale (22.5 % of the side)', async () => {
        const svg = fs.readFileSync(path.join(ASSETS, 'logo.svg'), 'utf8');
        assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-32 -32 64 64">/);
        assert.ok(svg.includes('<rect x="-32" y="-32" width="64" height="64" rx="14.4" fill="url(#bg)"/>'), 'the round corner');
        assert.ok(!svg.includes('rx="15"'), 'not the hand-picked corner it had before');
        // The mark is the network\'s own Pair, in its heavy form.
        assert.ok(svg.includes('<linearGradient id="ovgo"') && svg.includes('<linearGradient id="ovgv"'), 'the mark\'s two tones');
        assert.ok(svg.includes('scale(0.62) translate(-50 -50)'), 'the mark fills the tile');
    });

    await check('the file that ships is the one the script makes', async () => {
        assert.equal(fs.readFileSync(path.join(ASSETS, 'logo.svg'), 'utf8'), icons.tile(), 'run node scripts/build-icons.js');
        assert.strictEqual(icons.ROUNDING_NAME, 'round');
        assert.strictEqual(icons.ROUNDING.round, 0.225, 'the app icon\'s corner: 22.5 % of the side');
        assert.ok(!icons.tile().includes('rx="15"'), 'not the hand-picked corner it had before');
    });

    await check('the tab shows the file this site ships', async () => {
        const r = await t.get('/');
        assert.strictEqual(r.status, 200);
        assert.ok(r.text.includes('<link rel="icon" type="image/svg+xml" href="/assets/logo.svg">'), 'Space\'s own icon');
        assert.ok(!r.text.includes('href="data:image/svg+xml,'), 'the shared inline copy is not inlined any more');
        assert.ok(r.text.includes('<link rel="apple-touch-icon" href="/assets/logo-192.png">'), 'the touch icon is still the file');
    });

    await t.close();
    done();
})().catch((e) => { console.error(e); process.exitCode = 1; });
