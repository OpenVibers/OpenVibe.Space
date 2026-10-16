'use strict';
/**
 * The starters a space can begin from (templates/spaces/*.html). Each is one self-contained index.html built on the
 * space SDK, so it doubles as an example of every SDK feature: shared lists (guestbook, poll, leaderboard), private
 * storage (to-dos, the AI buddy's history), OpenVibe AI (the AI buddy) and server functions (trivia's hidden answers, in
 * templates/spaces/trivia.check.js, which a new space gets as functions/check.js).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'templates', 'spaces');
const TEMPLATES = [
    { id: 'guestbook', name: 'Guestbook', icon: 'fa-book-open', accent: '#c2410c', description: 'Visitors sign in and leave a note for everyone to read.', capabilities: ['profile', 'data'] },
    { id: 'ai-buddy', name: 'AI buddy', icon: 'fa-robot', accent: '#4f46e5', description: 'A chat with an AI character you describe; each visitor\'s conversation is kept for them.', capabilities: ['profile', 'kv', 'ai'],
        instructions: 'You are a friendly, curious and slightly funny companion. Keep answers short and warm, ask a question back now and then, and never pretend to be a person.' },
    { id: 'poll', name: 'Quick poll', icon: 'fa-square-poll-vertical', accent: '#059669', description: 'One question, a few answers, one vote each, live results.', capabilities: ['profile', 'data'] },
    { id: 'reaction', name: 'Reaction game', icon: 'fa-bolt', accent: '#16a34a', description: 'Click when it turns green; best times go on a leaderboard.', capabilities: ['profile', 'data'] },
    { id: 'trivia', name: 'Trivia', icon: 'fa-circle-question', accent: '#d97706', description: 'Questions whose answers stay on the server (a space function), with how many got each right.', capabilities: [], functions: ['check'] },
    { id: 'todo', name: 'Private to-dos', icon: 'fa-list-check', accent: '#ca8a04', description: 'A to-do list saved to each visitor\'s own account.', capabilities: ['profile', 'kv'] },
    { id: 'blank', name: 'Blank', icon: 'fa-file', accent: '#7c3aed', description: 'An empty page with sign-in, to build from scratch.', capabilities: ['profile'] },
];
const cache = new Map();

function list() { return TEMPLATES; }
function get(id) { return TEMPLATES.find((t) => t.id === id) || null; }
/** The template's files ([{ path, content }]), or null for an unknown id. */
function files(id) {
    const t = get(id);
    if (!t) return null;
    if (!cache.has(id)) {
        cache.set(id, [
            { path: 'index.html', content: fs.readFileSync(path.join(DIR, `${id}.html`), 'utf8') },
            // Its server functions: templates/spaces/<id>.<name>.js → functions/<name>.js.
            ...(t.functions || []).map((fn) => ({ path: `functions/${fn}.js`, content: fs.readFileSync(path.join(DIR, `${id}.${fn}.js`), 'utf8') })),
        ]);
    }
    return cache.get(id).map((f) => ({ ...f }));
}

module.exports = { list, get, files };
