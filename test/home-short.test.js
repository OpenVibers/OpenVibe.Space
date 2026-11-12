'use strict';
/**
 * The home on a phone (the owner's short-pages rule, 2026-10-30): the home's six parts are one pick block, a row of
 * chips picks one of them, and the parts a reader rarely needs are folds. Radio inputs and :has(), no script for the
 * chips; every part stays in the page for crawlers; a wider screen shows them all and no chips.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot, check, done } = require('./helpers/app');

(async () => {
    const t = await boot();
    try {
        await check('the home is one pick block: on a phone its parts are tabs, the first open, every part in the page', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200, r.text);
            const page = r.text;
            // From the block to the end of the page: its panes grew past a fixed window when section heads gained an icon (Shared 4.160.0).
            const block = page.slice(page.indexOf('<div class="pick" id="pick-parts">'));
            assert.ok(block.startsWith('<div class="pick" id="pick-parts">'), 'the pick block is on the home');
            // The owner, 11-11: "self-contained tabs, so the page isn't so freaking huge … at least on mobile" (Shared's
            // showcase.parts, a front page: tabs at 600 px and under; the old chips only jumped, so every pane showed).
            assert.match(block, /<div class="ov-parts ov-parts--front" data-parts="\d">/);
            const tabs = [...block.matchAll(/<label for="ovp-parts-([a-z]+)">([^<]+)<\/label>/g)];
            assert.ok(tabs.length >= 5, `a tab per part (${tabs.length})`);
            assert.ok(block.includes(`id="ovp-parts-${tabs[0][1]}" value="${tabs[0][1]}" checked>`), 'the first part is open');
            assert.ok(!block.includes('class="pick-chip"'), 'no jump chips beside the tabs');
            // Every part stays in the page, with the id a link opens it by.
            const panes = [...block.matchAll(/<div class="pick-pane" id="([a-z]+)">/g)].map((m) => m[1]);
            assert.deepStrictEqual(panes, tabs.map((m) => m[1]), 'every part is in the page, one per tab');
            // The parts themselves are all there: nothing was removed.
            for (const title of ['Start from a template', 'How a space comes together', 'How a deploy works', 'What works now', 'The same over the API', 'Quotas per project']) {
                assert.ok(page.includes(title), `${title} is on the page`);
            }
            assert.match(page, /<link rel="stylesheet" href="\/shared\/ov-parts\.css[^"]*">/, 'the tabs\' look is linked before the page draws');
        });

        await check('the parts a reader rarely needs are folds, open in the page and closed on a phone', async () => {
            const r = await t.get('/');
            const page = r.text;
            assert.ok(page.includes('<details class="sp-fold sp-fold-block" id="questions" open>'), 'the questions are a fold, open in the page');
            assert.ok(page.includes('document.getElementById("questions")'), 'the fold has the script that closes it on a phone');
            // The content of the fold stays in the page.
            assert.match(page, /What is a space\?/);
            assert.match(page, /Where did the forum go\?/);
        });
    } finally {
        await t.close();
    }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
