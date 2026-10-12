'use strict';
const { renderPage: spacePage, escapeHtml: esc } = require('./layout');
function renderPage(o) {
    const notice = o.notice ? `<p role="status" class="hd-flash hd-flash--${o.notice.kind === 'error' ? 'bad' : 'ok'}">${esc(o.notice.text)}</p>` : '';
    return spacePage({ title: o.title || 'Hosting', canonicalPath: o.path || '/dashboard', robots: o.indexable ? 'index,follow' : 'noindex,nofollow', body: `${notice}${o.body || ''}`, styles: o.styles || [], localStyles: ['css/hosting.css'], bodyClass: 'hosting-dashboard' });
}
module.exports = { renderPage, esc };
