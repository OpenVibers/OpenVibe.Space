'use strict';
// The home's picture is what Space does: a sentence in, an app out (the owner, 2026-11-09: no more "generic circled"
// homes). It is an example and says so, and it is still under reduced motion.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers/app');

(async () => {
    const t = await boot();
    try {
        const res = await fetch(`${t.base || t.url}/`);
        assert.strictEqual(res.status, 200);
        const home = await res.text();
        const scene = (home.match(/<figure class="sp-scene"[\s\S]*?<\/figure>/) || [''])[0];
        assert.ok(scene, 'the picture is in the hero');
        assert.match(scene, /<p class="sp-scene-ask"><span>You ask<\/span><b>A sign-up sheet for our game night<\/b><\/p>/);
        assert.match(scene, /<span>game-night\.openvibe\.space<\/span>/, 'the space has its own address');
        assert.strictEqual((scene.match(/<li>/g) || []).length, 3, 'three people on the sheet');
        assert.match(scene, /<figcaption>An example: /, 'it says it is an example');
        assert.ok(!/class="sc-orbit|sc-orbit-/.test(home), 'the generic orbit is gone from this home');
        const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'space.css'), 'utf8');
        assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.sp-scene-win, \.sp-scene-app li \{ animation: none; \} \}/);
        assert.match(css, /html\[data-ov-motion=reduced\] \.sp-scene-win/);
        console.log('home-picture: a request and the space it becomes, labelled an example, still under reduced motion');
    } finally {
        if (t.close) await t.close();
    }
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
