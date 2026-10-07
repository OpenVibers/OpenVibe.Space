'use strict';

/**
 * Server-side syntax highlighting (highlight.js, common language set). Rendered into the
 * HTML so crawlers and no-JS readers get the same page as everyone else. Anything the
 * highlighter cannot name comes back escaped as plain text — never unhighlighted markup.
 */
const hljs = require('highlight.js/lib/common');

const MAX_HIGHLIGHT_BYTES = 200 * 1024;  // beyond this the block is served as plain text

// Language names people type → highlight.js names (and a few aliases).
const ALIASES = {
    text: 'plaintext', txt: 'plaintext', plain: 'plaintext', log: 'plaintext',
    js: 'javascript', node: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'shell', ps1: 'powershell',
    yml: 'yaml', md: 'markdown', 'c++': 'cpp', cc: 'cpp', h: 'c', cs: 'csharp', 'c#': 'csharp',
    rb: 'ruby', rs: 'rust', golang: 'go', kt: 'kotlin', docker: 'dockerfile', html: 'xml', htm: 'xml', vue: 'xml', svg: 'xml',
    conf: 'ini', toml: 'ini', env: 'ini', make: 'makefile', mk: 'makefile', patch: 'diff',
};

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function resolveLanguage(name) {
    const raw = String(name || 'text').trim().toLowerCase();
    const mapped = ALIASES[raw] || raw;
    return hljs.getLanguage(mapped) ? mapped : 'plaintext';
}

/**
 * @returns {{ html: string, language: string, lines: number, highlighted: boolean }}
 *   html is the inner HTML of a <code> element.
 */
function highlight(content, language) {
    const text = String(content || '');
    const lines = text.length ? text.split('\n').length : 0;
    const lang = resolveLanguage(language);
    if (lang === 'plaintext' || Buffer.byteLength(text, 'utf8') > MAX_HIGHLIGHT_BYTES) {
        return { html: escapeHtml(text), language: lang, lines, highlighted: false };
    }
    try {
        const out = hljs.highlight(text, { language: lang, ignoreIllegals: true });
        return { html: out.value, language: lang, lines, highlighted: true };
    } catch {
        return { html: escapeHtml(text), language: 'plaintext', lines, highlighted: false };
    }
}

module.exports = { highlight, escapeHtml, resolveLanguage };
