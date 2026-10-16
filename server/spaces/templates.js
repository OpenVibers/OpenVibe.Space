'use strict';
/**
 * The starters a space can begin from (templates/spaces/*.html). Each is one self-contained index.html built on the
 * space SDK, so it doubles as an example of every SDK feature: shared lists (guestbook, poll, leaderboard), private
 * storage (to-dos, the AI buddy's history) and OpenVibe AI (the AI buddy).
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
    if (!cache.has(id)) cache.set(id, fs.readFileSync(path.join(DIR, `${id}.html`), 'utf8'));
    return [{ path: 'index.html', content: cache.get(id) }];
}

module.exports = { list, get, files };
