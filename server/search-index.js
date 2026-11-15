'use strict';
/**
 * Hosted websites in OpenVibe.Search (plan §AD.10 step 6: a site that goes live is in the feed, on its owner's profile
 * and in search). Every site anyone can open now (active, a ready deploy live, not scratch, not in a sandbox project,
 * not taken down: the sites GET /api/v1/people/:subject/sites lists) is one document (search.index-document@1, owner
 * space, type site, id = the site's id), written through Search's owner API with Space's service token
 * (search.document.write on openvibe.search). Its words come from the live deploy's index.html: the title, the
 * description and the visible text. A page that asks not to be indexed (meta robots noindex), and a site that stops
 * being live, is tombstoned.
 *
 * Runs a minute after boot and every 30 minutes; the stored copy is read back for each site and re-sent, one revision
 * up, only when its content differs. Off unless the search URL and the OAuth client secret are set.
 */
const fs = require('fs');
const { serviceAuth } = require('openvibe-contracts');

const OWNER = 'space';
const TYPE = 'site';
const EVERY_MS = 30 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/;
const COMPARED = ['canonical_url', 'title', 'summary', 'body'];
const MAX_HTML = 512 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
    if (/^#x/i.test(e)) { const n = parseInt(e.slice(2), 16); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
    if (/^#\d/.test(e)) { const n = Number(e.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
    return ENTITIES[e.toLowerCase()] ?? m;
});
const squash = (s) => decode(s).replace(/\s+/g, ' ').trim();

/** A page's words → { title, description, text, noindex } (no script, style or markup; entities decoded). */
function wordsOf(html) {
    const h = String(html || '').slice(0, MAX_HTML);
    const meta = (name) => {
        for (const tag of h.match(/<meta\b[^>]*>/gi) || []) {
            const n = /\bname\s*=\s*["']?([^"'\s>]+)/i.exec(tag);
            if (!n || n[1].toLowerCase() !== name) continue;
            const c = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
            if (c) return squash(c[1] ?? c[2]);
        }
        return '';
    };
    const title = squash((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) || [])[1] || '');
    const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(h) || [null, h])[1];
    const text = squash(body.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '));
    return { title, description: meta('description'), text, noindex: /\bnoindex\b/i.test(meta('robots')) };
}

/** A live site and its page's words → the document body; identity and revision are added by the caller. */
function documentFor(site, words, { hostname, url }) {
    const title = (words.title || site.name).slice(0, 500);
    return {
        visibility: 'public',
        canonical_url: url,
        title,
        summary: (words.description || (words.text ? words.text.slice(0, 300) : `${hostname}, a website on OpenVibe.Space.`)).slice(0, 4000),
        body: [title, words.description, words.text].filter(Boolean).join('\n').slice(0, 48000),
        facets: { kind: 'website', host: hostname.slice(0, 200) },
        authorship: 'human',
        publication_state: 'published',
        indexability: { decision: 'index', reasons: [] },
    };
}

function createSiteSearchIndex({ db, blobs, sites, takedowns, config, fetchImpl = globalThis.fetch, log = console, tokens = null }) {
    const url = String((config.search && config.search.url) || '').replace(/\/+$/, '');
    const enabled = Boolean(url && (tokens || (config.oauth && config.oauth.clientSecret)));
    const auth = tokens || (enabled ? serviceAuth.createTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
        audience: 'openvibe.search', scope: 'search.document.write', fetchImpl,
    }) : null);
    const live = db.prepare(`SELECT s.id, s.project_id, s.name, s.active_deploy_id
        FROM space_sites s
        JOIN space_projects p ON p.id = s.project_id
        JOIN space_deploys d ON d.id = s.active_deploy_id
        WHERE p.status = 'active' AND p.environment = 'production' AND s.status = 'active' AND NOT s.scratch AND d.state = 'ready'
        ORDER BY s.seq LIMIT 5000`);
    const indexFile = db.prepare(`SELECT f.sha256, f.size, d.project_id FROM space_deploy_files f JOIN space_deploys d ON d.id = f.deploy_id
        WHERE f.deploy_id = ? AND f.path = 'index.html'`);
    const stats = { runs: 0, upserted: 0, deleted: 0, unchanged: 0, failed: 0, last_error: null };
    const siteUrl = (hostname) => {
        const u = new URL(config.baseUrl);
        return `${u.protocol}//${hostname}${u.port ? `:${u.port}` : ''}/`;
    };

    async function call(method, p, body) {
        const res = await fetchImpl(`${url}${p}`, {
            method,
            headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await auth.authHeaders()) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15000),
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401 && auth.invalidate) auth.invalidate();
        return { status: res.status, ok: res.ok, body: json };
    }

    async function pageWords(site) {
        const row = await indexFile.get(site.active_deploy_id);
        if (!row || Number(row.size) > MAX_HTML * 4) return { title: '', description: '', text: '', noindex: false };
        const file = await blobs.ensure(row.project_id, row.sha256);
        const fh = await fs.promises.open(file, 'r');
        try {
            const buf = Buffer.alloc(Math.min(Number(row.size) || 0, MAX_HTML));
            await fh.read(buf, 0, buf.length, 0);
            return wordsOf(buf.toString('utf8'));
        } finally { await fh.close(); }
    }

    async function run() {
        if (!enabled) return null;
        stats.runs++;
        const listing = await call('GET', `/api/v1/owners/${OWNER}/documents?type=${TYPE}&limit=1000`);
        if (!listing.ok) throw new Error(`listing: ${listing.status} ${listing.body.code || ''}`);
        const remote = new Map((listing.body.documents || []).map((d) => [d.id, d]));
        const keep = new Set();
        for (const site of await live.all()) {
            if (!ID_RE.test(String(site.id))) continue;
            if (await takedowns.ofSite(site)) continue;
            let words;
            try { words = await pageWords(site); } catch (err) { stats.failed++; stats.last_error = `${site.id}: ${err.message}`; keep.add(site.id); continue; }
            if (words.noindex) continue;
            keep.add(site.id);
            const hostname = sites.defaultHostname(site.name);
            const doc = documentFor(site, words, { hostname, url: siteUrl(hostname) });
            const r = remote.get(site.id);
            if (r && !r.deleted) {
                const stored = await call('GET', `/api/v1/owners/${OWNER}/documents/${TYPE}/${encodeURIComponent(site.id)}`);
                const s = stored.ok ? stored.body.document : null;
                if (s && COMPARED.every((k) => s[k] === doc[k])) { stats.unchanged++; continue; }
            }
            const res = await call('PUT', `/api/v1/documents/${OWNER}/${TYPE}/${encodeURIComponent(site.id)}`, { ...doc, revision: r ? Number(r.revision) + 1 : 1 });
            if (res.ok) stats.upserted++;
            else { stats.failed++; stats.last_error = `${site.id}: ${res.status} ${res.body.code || ''}`; }
        }
        for (const [id, r] of remote) {
            if (keep.has(id) || r.deleted) continue;
            const res = await call('DELETE', `/api/v1/documents/${OWNER}/${TYPE}/${encodeURIComponent(id)}?revision=${Number(r.revision) + 1}`);
            if (res.ok) stats.deleted++;
            else { stats.failed++; stats.last_error = `${id}: ${res.status} ${res.body.code || ''}`; }
        }
        return { ...stats };
    }

    const quietly = () => run().catch((err) => { stats.failed++; stats.last_error = err.message; log.warn(`[Space] search index run failed: ${err.message}`); });
    let timer = null;
    let first = null;
    return {
        enabled,
        run,
        stats: () => ({ ...stats }),
        start({ firstDelayMs = 60_000 } = {}) {
            if (!enabled || timer) return;
            first = setTimeout(quietly, firstDelayMs);
            if (first.unref) first.unref();
            timer = setInterval(quietly, EVERY_MS);
            if (timer.unref) timer.unref();
        },
        stop() { clearTimeout(first); clearInterval(timer); timer = null; first = null; },
    };
}

module.exports = { createSiteSearchIndex, documentFor, wordsOf };
