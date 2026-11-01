'use strict';
/**
 * The starter site templates keep their words readable (WCAG 2.1 AA). The event page's pink is a fill, so its date and
 * times use a darker pink that reads 5.6:1 on white; the landing page's green is 4.35:1 both as a button fill and as
 * text on white, so the light theme uses the darker green that reads 5.7:1 both ways.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (id) => fs.readFileSync(path.join(__dirname, '..', 'templates', 'spaces', `${id}.html`), 'utf8');

const event = read('site-event');
assert.match(event, /--accent-text:\s*#b8326f;/, 'the event page has the readable text pink on white');
assert.match(event, /\.btn \{[^}]*background: var\(--accent-text\); color: var\(--on-accent\);/, 'its filled buttons carry white on the deep pink (5.6:1), not on #d9468a (4.0:1)');
assert.match(event, /@media \(prefers-color-scheme: dark\)[^{]*\{[^}]*--accent-text:\s*#ff7ab6;/, 'and the brighter pink on the dark page');
assert.match(event, /\.date \{[^}]*color: var\(--accent-text\)/, 'the date uses the text pink');
assert.match(event, /\.timeline time \{[^}]*color: var\(--accent-text\)/, 'the event times use the text pink');
assert.ok(!/\.(date|timeline time) \{[^}]*color: var\(--accent\)/.test(event), 'no text uses the fill pink');

const landing = read('site-landing');
assert.match(landing, /--accent:\s*#0b7550;/, 'the landing page uses the readable green');
assert.ok(!landing.includes('#0f8a5f'), 'the 4.35:1 green is gone from the template');

console.log('template colours: the event text pink and the landing green are readable');
