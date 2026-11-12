'use strict';
/**
 * The home on a phone (the owner's short-pages rule, 2026-10-30): one or two screens, app-like.
 *
 *   pickBlock()  several blocks of the same kind, one at a time on a phone as tabs (showcase.parts): radios and
 *                :has(), no script; every block stays in the page for crawlers, and a wider screen (or a browser
 *                without :has()) shows them all.
 *   foldBlock()  a part a reader rarely needs, closed on a phone and open where there is room. The page's own markup
 *                keeps it open, so a browser without the script shows it as before; the script closes it on a narrow
 *                screen and remembers the reader's choice.
 *
 * The CSS for both lives in public/css/space.css; the rule that shows the picked block is written for the page,
 * because there is one per block.
 */
const { pick } = require('openvibe-shared/showcase');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A pick block: the page's own blocks, one at a time as tabs on a phone (openvibe-shared showcase.parts, the same tabs
 * as every OpenVibe page; the owner, 2026-11-11: "self-contained tabs, so the page isn't so freaking huge … at least on
 * mobile"). Every pane stays in the page for crawlers, a wider screen stacks them, and a link to a pane's id (an
 * anchor in the hero) opens its tab. The old chips only jumped to a pane, so a phone still showed all of them.
 *
 *   pickBlock({ key, label, head, panes })   panes: [{ id, label, html }]
 */
function pickBlock({ key, label, head = '', panes }) {
    return pick({ key, label, head, panes });
}



/**
 * What a fold holds, counted, for its title row (the owner, 2026-10-31: a fold that shortens a page shows its count):
 * "6 questions", "12 items", "latest 5" for the shipped list, or nothing when there is nothing to count. Replaces the
 * old "tap to open".
 */
function foldMeta(body, cls = '') {
    const s = typeof body === 'string' ? body : String((body && (body.s || body.html || body.value)) || body || '');
    const n = (re) => (s.match(re) || []).length;
    const shipped = /data-ov-shipped="list"[^>]*?data-limit="(\d+)"|data-limit="(\d+)"[^>]*?data-ov-shipped="list"/.exec(s);
    const q = n(/<details[\s>]/g), li = n(/<li[\s>]/g), a = n(/<a\s/g);
    const text = shipped ? `latest ${shipped[1] || shipped[2]}` : q > 1 ? `${q} questions` : li > 1 ? `${li} items` : a > 1 ? `${a} links` : '';
    return text ? `<span${cls ? ` class="${cls}"` : ''}>${text}</span>` : '';
}

/**
 * A fold. The head is the heading the block had; the html is what it holds.
 *
 *   foldBlock({ id, head, html })
 */
function foldBlock({ id, head, html }) {
    return `<details class="sp-fold sp-fold-block" id="${esc(id)}" open><summary>${head}${foldMeta(html)}</summary>${html}</details>${foldScript(id)}`;
}

/** The script a fold carries: closed on a phone unless the reader opened it before, and it remembers that. */
function foldScript(id) {
    return `<script>(function(){var d=document.getElementById(${JSON.stringify(id)});if(!d)return;var k='ov_fold_'+${JSON.stringify(id)};var s=null;try{s=localStorage.getItem(k)}catch(e){}if(s==='open'){d.open=true;return}if(s==='closed'){d.open=false;return}var t=0;if(window.matchMedia&&window.matchMedia('(max-width:640px)').matches){t=Date.now();d.open=false}d.addEventListener('toggle',function(){if(Date.now()-t<300)return;try{localStorage.setItem(k,d.open?'open':'closed')}catch(e){}})})();</script>`;
}

module.exports = { pickBlock, foldBlock, foldMeta, foldScript };
