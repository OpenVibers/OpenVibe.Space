'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'website-arrival.js'), 'utf8');

function visit(hint) {
    const calls = { navigations: [], frames: [], message: null };
    const frame = { contentWindow: {}, setAttribute() {}, style: {}, remove() { calls.removed = true; } };
    const window = {
        addEventListener(_type, fn) { calls.message = fn; },
        removeEventListener() { calls.message = null; },
    };
    window.top = window;
    vm.runInNewContext(script, {
        window, URL, encodeURIComponent,
        localStorage: { getItem() { return hint || null; } },
        document: { createElement() { return frame; }, body: { appendChild(el) { calls.frames.push(el); } } },
        location: { origin: 'https://openvibe.website', replace(url) { calls.navigations.push(url); } },
        setTimeout() { return 1; }, clearTimeout() {},
    });
    return { calls, frame };
}

const guest = visit('guest');
assert.strictEqual(guest.calls.frames.length, 0, 'an explicit guest does not check Network');

const checked = visit();
assert.strictEqual(checked.calls.frames.length, 1);
assert.match(checked.frame.src, /^https:\/\/openvibe\.network\/sso\/check\?origin=/);
checked.calls.message({ origin: 'https://other.example', source: checked.frame.contentWindow, data: { type: 'ov-sso', signedIn: true } });
checked.calls.message({ origin: 'https://openvibe.network', source: {}, data: { type: 'ov-sso', signedIn: true } });
assert.deepStrictEqual(checked.calls.navigations, [], 'an unrelated sender cannot move the browser');
checked.calls.message({ origin: 'https://openvibe.network', source: checked.frame.contentWindow, data: { type: 'ov-sso', signedIn: true } });
assert.deepStrictEqual(checked.calls.navigations, ['https://openvibe.space/spaces/mine']);
assert.strictEqual(checked.calls.removed, true);

const negative = visit();
negative.calls.message({ origin: 'https://openvibe.network', source: negative.frame.contentWindow, data: { type: 'ov-sso', signedIn: false } });
assert.deepStrictEqual(negative.calls.navigations, [], 'a Network guest stays on the public front door');

console.log('website arrival: guest, verified account, spoofed sender, and Network guest passed');
