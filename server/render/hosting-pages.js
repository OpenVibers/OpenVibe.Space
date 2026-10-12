'use strict';
/**
 * Dashboard page bodies. Every value is escaped; every action is a POST form carrying the form
 * token, so the dashboard works without JavaScript. Styles: public/css/hosting.css (hd-*), loaded
 * only on these pages.
 */
const { esc } = require('./hosting-layout');

const bytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GiB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);
const when = (ms) => (ms ? `<time datetime="${new Date(ms).toISOString()}">${esc(new Date(ms).toISOString().replace('T', ' ').slice(0, 16))} UTC</time>` : '');
const short = (id) => esc(String(id || '').slice(0, 12));
const icon = (name) => `<i class="fa-solid ${name}" aria-hidden="true"></i>`;
const badge = (text, tone = 'neutral') => `<span class="hd-badge hd-badge--${tone}">${esc(text)}</span>`;
const STATE_TONE = { ready: 'ok', failed: 'bad', receiving: 'warn', processing: 'warn' };

function form(action, csrf, inner, { cls = '', confirm = null, enctype = null } = {}) {
    return `<form method="post" action="${esc(action)}"${cls ? ` class="${cls}"` : ''}${enctype ? ` enctype="${enctype}"` : ''}>`
        + `<input type="hidden" name="csrf" value="${esc(csrf)}">${inner}`
        + `${confirm ? `<label class="hd-confirm"><input type="checkbox" name="confirm" value="yes" required> ${esc(confirm)}</label>` : ''}</form>`;
}

function crumbs(list) {
    return `<nav class="hd-crumbs" aria-label="Breadcrumb">${list.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join('<span aria-hidden="true">›</span>')}</nav>`;
}

function card(title, inner, { sub = '', actions = '', cls = '', id = '' } = {}) {
    return `<section class="hd-card${cls ? ` ${cls}` : ''}"${id ? ` id="${esc(id)}"` : ''}>`
        + `<header class="hd-card__head"><div><h2>${title}</h2>${sub ? `<p class="hd-muted">${sub}</p>` : ''}</div>${actions ? `<div class="hd-card__actions">${actions}</div>` : ''}</header>`
        + `${inner}</section>`;
}

function home({ projects, csrf, canCreate = true }) {
    const cards = projects.map((p) => `<a class="hd-tile" href="/projects/${esc(p.id)}">
<span class="hd-tile__icon">${icon('fa-folder-open')}</span>
<span class="hd-tile__body"><strong>${esc(p.name)}</strong><span class="hd-tile__meta">${badge(p.environment, p.environment === 'sandbox' ? 'warn' : 'accent')}${p.role ? ` ${badge(p.role)}` : ''}</span><span class="hd-muted">Created ${when(p.created_at)}</span></span>
<span class="hd-tile__go" aria-hidden="true">${icon('fa-arrow-right')}</span></a>`).join('');
    const create = !canCreate
        ? `<div class="hd-callout">${icon('fa-lock')}<p>OpenVibe.Space is not open for hosting yet. It opens after a launch review (abuse handling and a designated DMCA agent first); until then only OpenVibe staff can create projects.</p></div>`
        : form('/projects', csrf, `<div class="hd-fields">
<label class="hd-field">Name <input name="name" required maxlength="80" placeholder="My website"></label>
<label class="hd-field">Environment <select name="environment"><option value="production">production</option><option value="sandbox">sandbox (smaller quotas, noindex, no custom domains)</option></select></label>
</div><button type="submit" class="hd-btn hd-btn--primary">${icon('fa-plus')} Create project</button>`, { cls: 'hd-form' });
    return `<header class="hd-head"><p class="hd-eyebrow">${icon('fa-globe')} Static hosting</p><h1>Your projects</h1>
<p class="hd-sub">A project holds sites, their deploys and domains, and the people who may change them.</p></header>
${projects.length ? `<div class="hd-tiles">${cards}</div>` : `<div class="hd-empty">${icon('fa-folder-plus')}<p>You have no projects yet.</p></div>`}
${card('New project', create, { sub: canCreate ? 'Production sites can take custom domains; a sandbox is for trying things and is never indexed.' : '' })}`;
}

function meter(label, used, limit, fmt = (x) => esc(x)) {
    const pct = limit > 0 ? Math.min(100, Math.round((Number(used) / Number(limit)) * 100)) : 0;
    const tone = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok';
    return `<div class="hd-meter"><div class="hd-meter__label"><span>${label}</span><span><strong>${fmt(used)}</strong> of ${fmt(limit)}</span></div>`
        + `<div class="hd-meter__bar hd-meter__bar--${tone}" role="img" aria-label="${pct}% used"><span style="width:${pct}%"></span></div></div>`;
}

function quotaTable(quota, usage) {
    return `<div class="hd-meters">
${meter('Storage', usage.storageBytes, quota.storageBytes, bytes)}
${meter('Deploys in the last 24 h', usage.deploysLast24h, quota.deploysPerDay)}
${meter('Sites', usage.sites, quota.sites)}
${meter('Custom domains', usage.customDomains, quota.customDomains)}
</div>
<dl class="hd-facts"><div><dt>Files per deploy</dt><dd>${esc(Number(quota.maxFiles).toLocaleString('en-US'))}</dd></div><div><dt>Largest file</dt><dd>${bytes(quota.maxFileBytes)}</dd></div></dl>`;
}

function project({ project: p, role, sites, quota, usage, members, csrf, siteUrl }) {
    const canMaintain = role === 'owner' || role === 'maintainer' || role === 'staff';
    const siteRows = sites.map((s) => `<li class="hd-row">
<span class="hd-row__main"><a class="hd-row__title" href="/sites/${esc(s.id)}">${esc(s.name)}</a><a class="hd-url" href="${esc(siteUrl(s))}" rel="noopener">${esc(siteUrl(s).replace(/^https?:\/\//, ''))} ${icon('fa-arrow-up-right-from-square')}</a></span>
<span class="hd-row__side">${s.active_deploy_id ? `${badge('live', 'ok')} <code>${short(s.active_deploy_id)}</code>` : badge('nothing published')}</span></li>`).join('');
    const memberRows = members.map((m) => `<tr><td><code>${esc(m.principal)}</code></td><td>${badge(m.role, m.role === 'owner' ? 'accent' : 'neutral')}</td><td class="hd-actions">${role === 'owner' && m.principal !== p.owner_subject
        ? form(`/projects/${p.id}/members/remove`, csrf, `<input type="hidden" name="principal" value="${esc(m.principal)}"><button type="submit" class="hd-link hd-link--danger">Remove</button>`, { cls: 'hd-inline' }) : ''}</td></tr>`).join('');
    return `<header class="hd-head">${crumbs([['/dashboard', 'Projects']])}
<h1>${esc(p.name)}</h1>
<p class="hd-chips">${badge(p.environment, p.environment === 'sandbox' ? 'warn' : 'accent')} ${badge(`your role: ${role}`)} <code>${esc(p.id)}</code>${p.network_project_id ? ` <span class="hd-muted">Network project <code>${esc(p.network_project_id)}</code></span>` : ''}</p></header>
<div class="hd-split">
<div class="hd-split__main">
${card('Sites', `${sites.length ? `<ul class="hd-rows">${siteRows}</ul>` : `<div class="hd-empty hd-empty--small">${icon('fa-globe')}<p>No sites yet.</p></div>`}
${canMaintain ? form(`/projects/${p.id}/sites`, csrf, `<label class="hd-field">New site name <input name="name" required pattern="[a-z0-9-]{3,40}" maxlength="40" placeholder="my-site"></label><button type="submit" class="hd-btn hd-btn--primary">${icon('fa-plus')} Create site</button>`, { cls: 'hd-form hd-form--row' }) : ''}`, { sub: 'Each site is served at its own address under openvibe.website.' })}
${card('Members', `<div class="hd-table-wrap"><table class="hd-table"><thead><tr><th>Principal</th><th>Role</th><th></th></tr></thead><tbody>${memberRows}</tbody></table></div>
${role === 'owner' ? form(`/projects/${p.id}/members`, csrf, `<label class="hd-field">Principal <input name="principal" required placeholder="usr_… or app:app_…"></label>
<label class="hd-field">Role <select name="role"><option value="deployer">deployer</option><option value="maintainer">maintainer</option></select></label><button type="submit" class="hd-btn">Add or change</button>`, { cls: 'hd-form hd-form--row' }) : ''}`, { sub: 'Deployers upload and activate; maintainers also manage sites, domains and configuration.' })}
</div>
<aside class="hd-split__side">
${card('Quotas', quotaTable(quota, usage))}
</aside>
</div>
${role === 'owner' || role === 'staff' ? card('Delete project', form(`/projects/${p.id}/delete`, csrf, '<button type="submit" class="hd-btn hd-btn--danger">Delete this project, its sites and every deploy</button>', { cls: 'hd-form', confirm: 'I understand every site stops at once' }), { cls: 'hd-card--danger', sub: 'Every site in it stops being served at once, and its deploys are deleted.' }) : ''}`;
}

function domainBlock(d, instructions, csrf) {
    const status = d.status === 'verified' ? badge('verified · served', 'ok') : badge(`${d.status} · not served`, 'warn');
    let body = `<li class="hd-domain"><div class="hd-domain__head"><strong>${esc(d.hostname)}</strong> ${badge(d.kind)} ${status}</div>${d.last_error ? `<p class="hd-muted">${esc(d.last_error)}</p>` : ''}`;
    if (instructions) {
        const rec = (r) => `<tr><td>${badge(r.type)}</td><td><code>${esc(r.name)}</code></td><td><code class="hd-wrap">${esc(r.value)}</code></td><td class="hd-muted">${esc(r.note)}</td></tr>`;
        body += `<details class="hd-details"${d.status === 'verified' ? '' : ' open'}><summary>DNS records</summary><div class="hd-table-wrap"><table class="hd-table hd-table--dns"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th></th></tr></thead><tbody>`
            + rec(instructions.verification) + instructions.routing.map(rec).join('')
            + `</tbody></table></div><p class="hd-muted">${esc(instructions.tls)}</p></details>`;
        body += '<div class="hd-domain__actions">';
        if (d.status !== 'verified') body += form(`/domains/${d.id}/verify`, csrf, `<button type="submit" class="hd-btn hd-btn--small">${icon('fa-rotate')} Check DNS now</button>`, { cls: 'hd-inline' });
        body += form(`/domains/${d.id}/delete`, csrf, '<button type="submit" class="hd-link hd-link--danger">Remove</button>', { cls: 'hd-inline' });
        body += '</div>';
    }
    return `${body}</li>`;
}

function site({ site: s, project: p, role, deploys, activations, domains, siteConfig, csrf, url, now = Date.now() }) {
    const canMaintain = role === 'owner' || role === 'maintainer' || role === 'staff';
    const canDeploy = role !== 'staff';
    // The site's one live preview (plan T12 J4): served to project members on this dashboard until it expires.
    const previewId = s.preview_deploy_id && Number(s.preview_expires_at) > now ? s.preview_deploy_id : null;
    const previewHref = (id) => `/preview/${encodeURIComponent(id)}/`;
    const rows = deploys.map((d) => {
        const active = d.id === s.active_deploy_id;
        const previewing = d.id === previewId;
        const actions = [];
        if (previewing && d.state === 'ready') actions.push(`<a class="hd-btn hd-btn--small" href="${esc(previewHref(d.id))}" target="_blank" rel="noopener">${icon('fa-eye')} Open preview</a>`);
        if (canDeploy && d.state === 'ready' && !active) actions.push(form(`/deploys/${d.id}/activate`, csrf, `<input type="hidden" name="expected_active" value="${esc(s.active_deploy_id || '')}"><button type="submit" class="hd-btn hd-btn--small hd-btn--primary">Activate</button>`, { cls: 'hd-inline' }));
        if (canMaintain && !active) actions.push(form(`/deploys/${d.id}/delete`, csrf, '<button type="submit" class="hd-link hd-link--danger">Delete</button>', { cls: 'hd-inline' }));
        return `<tr${active ? ' class="hd-active"' : ''}><td><a href="/deploys/${esc(d.id)}"><code>${short(d.id)}</code></a>${active ? ` ${badge('active', 'accent')}` : ''}${previewing ? ` ${badge('preview', 'warn')}` : ''}</td>`
            + `<td>${badge(d.state, STATE_TONE[d.state] || 'neutral')}${d.failure_code ? ` <code>${esc(d.failure_code)}</code>` : ''}</td><td class="hd-num">${esc(d.file_count)}</td><td class="hd-num">${bytes(d.total_bytes)}</td><td>${when(d.created_at)}</td><td class="hd-actions">${actions.join(' ')}</td></tr>`;
    }).join('');
    const history = activations.slice(0, 10).map((a) => `<li>${when(a.created_at)} <span>${esc(a.kind)} → <code>${short(a.deploy_id)}</code>${a.previous_deploy_id ? ` <span class="hd-muted">(was <code>${short(a.previous_deploy_id)}</code>)</span>` : ''} <span class="hd-muted">by <code>${esc(a.actor)}</code></span></span></li>`).join('');
    const status = s.active_deploy_id ? `${badge('live', 'ok')} <code>${short(s.active_deploy_id)}</code>` : badge('nothing published');
    const rollback = canDeploy && s.active_deploy_id ? form(`/sites/${s.id}/rollback`, csrf, `<input type="hidden" name="expected_active" value="${esc(s.active_deploy_id)}"><button type="submit" class="hd-btn hd-btn--small">${icon('fa-clock-rotate-left')} Roll back to the previous deploy</button>`, { cls: 'hd-inline' }) : '';
    return `<header class="hd-head">${crumbs([['/dashboard', 'Projects'], [`/projects/${p.id}`, p.name]])}
<h1>${esc(s.name)}</h1>
<p class="hd-chips"><a class="hd-url hd-url--big" href="${esc(url)}" rel="noopener">${esc(url.replace(/^https?:\/\//, ''))} ${icon('fa-arrow-up-right-from-square')}</a> ${status} <code>${esc(s.id)}</code></p></header>
${canDeploy ? card('Upload a deploy', form(`/sites/${s.id}/deploys`, csrf, `<div class="hd-sources">
<fieldset class="hd-source"><legend>${icon('fa-folder-open')} A folder</legend><input type="file" name="files" multiple webkitdirectory><input type="hidden" name="strip" value="folder"></fieldset>
<fieldset class="hd-source"><legend>${icon('fa-file-zipper')} …or an archive (.tar.gz / .tar)</legend><input type="file" name="archive" accept=".tar,.tgz,.gz,application/gzip,application/x-tar"></fieldset>
</div>
<label class="hd-field hd-field--narrow">Deploy from subfolder (optional) <input name="root" placeholder="dist"></label>
<fieldset class="hd-choices"><legend>When it is ready</legend>
<label class="hd-choice"><input type="radio" name="mode" value="activate" checked><span><strong>Activate it</strong><span class="hd-muted">Live as soon as it is checked.</span></span></label>
<label class="hd-choice"><input type="radio" name="mode" value="ready"><span><strong>Keep it ready</strong><span class="hd-muted">Activate later from the list below.</span></span></label>
<label class="hd-choice"><input type="radio" name="mode" value="preview"><span><strong>Preview only</strong><span class="hd-muted">A private address for members of this project, for one hour.</span></span></label>
</fieldset>
<button type="submit" class="hd-btn hd-btn--primary">${icon('fa-cloud-arrow-up')} Upload</button>`, { cls: 'hd-form', enctype: 'multipart/form-data' }),
    { sub: 'Static files only: HTML, CSS, JavaScript, JSON, images, fonts, audio, video, PDF, WebAssembly. No build runs and nothing is executed. Hidden files (except <code>.well-known/</code>), links and server-side code are refused.' }) : ''}
${card('Deploys', `${previewId ? `<p class="hd-notice">${icon('fa-eye')} A preview of <code>${short(previewId)}</code> is open to members of this project at <a href="${esc(previewHref(previewId))}" target="_blank" rel="noopener">${esc(previewHref(previewId))}</a> until ${when(Number(s.preview_expires_at))}. It is never indexed, and activating or rolling back ends it.</p>` : ''}
${deploys.length ? `<div class="hd-table-wrap"><table class="hd-table"><thead><tr><th>Deploy</th><th>State</th><th class="hd-num">Files</th><th class="hd-num">Size</th><th>Uploaded</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="hd-empty hd-empty--small">${icon('fa-box-open')}<p>No deploys yet.</p></div>`}
${history ? `<details class="hd-details"><summary>Activation history</summary><ul class="hd-history">${history}</ul></details>` : ''}`, { actions: rollback, sub: 'Every deploy is kept. Activating one switches the site at once; nothing is rebuilt.' })}
${card('Domains', `<ul class="hd-domains">${domains.map((d) => domainBlock(d.domain, d.instructions, csrf)).join('')}</ul>
${canMaintain && p.environment !== 'sandbox' ? form(`/sites/${s.id}/domains`, csrf, `<label class="hd-field">Custom domain <input name="hostname" required placeholder="www.example.org"></label><button type="submit" class="hd-btn">${icon('fa-plus')} Add domain</button>`, { cls: 'hd-form hd-form--row' }) : ''}`, { sub: 'A custom domain is served once its TXT record is found.' })}
${canMaintain ? card('Per-site configuration', form(`/sites/${s.id}/config`, csrf, `<label class="hd-field">Headers <span class="hd-muted">one per line: <code>Name: value</code></span><textarea name="headers" rows="4" spellcheck="false" placeholder="X-Frame-Options: SAMEORIGIN">${esc(siteConfig.headersText)}</textarea></label>
<label class="hd-field">Redirects <span class="hd-muted">one per line: <code>from -&gt; to [status]</code></span><textarea name="redirects" rows="4" spellcheck="false" placeholder="/old -&gt; /new 301">${esc(siteConfig.redirectsText)}</textarea></label>
<label class="hd-confirm"><input type="checkbox" name="spa" value="1"${siteConfig.spa ? ' checked' : ''}> Serve index.html for extensionless paths (single-page app)</label>
<button type="submit" class="hd-btn hd-btn--primary">Save configuration</button>`, { cls: 'hd-form' }),
    { sub: 'Headers, redirects and an SPA fallback, applied to every response of this site. Platform headers (Content-Security-Policy, Strict-Transport-Security, Set-Cookie, X-Forwarded-*, caching) cannot be set here, and a redirect target must be a local path.' }) : ''}
${canMaintain ? card('Delete site', form(`/sites/${s.id}/delete`, csrf, '<button type="submit" class="hd-btn hd-btn--danger">Delete this site</button>', { cls: 'hd-form', confirm: `${s.name} stops being served at once` }), { cls: 'hd-card--danger', sub: 'The site and its deploys are deleted; its address stops answering.' }) : ''}`;
}

function deploy({ deploy: d, site: s, project: p, files, log, active }) {
    const LEVEL_TONE = { error: 'bad', warn: 'warn', info: 'neutral' };
    const logLines = log.map((l) => `<li class="hd-log__line hd-log__line--${esc(l.level)}">${badge(l.level, LEVEL_TONE[l.level] || 'neutral')}<span>${esc(l.message)}</span></li>`).join('');
    const fileRows = files.slice(0, 2000).map((f) => `<tr><td><code class="hd-wrap">${esc(f.path)}</code></td><td class="hd-muted">${esc(f.content_type)}</td><td class="hd-num">${bytes(f.size)}</td><td><code title="${esc(f.sha256)}">${esc(f.sha256.slice(0, 12))}</code></td></tr>`).join('');
    return `<header class="hd-head">${crumbs([['/dashboard', 'Projects'], [`/projects/${p.id}`, p.name], [`/sites/${s.id}`, s.name]])}
<h1>Deploy <code>${short(d.id)}</code></h1>
<p class="hd-chips">${badge(d.state, STATE_TONE[d.state] || 'neutral')}${active ? ` ${badge('active', 'accent')}` : ''}</p>
<dl class="hd-facts hd-facts--wide"><div><dt>Files</dt><dd>${esc(d.file_count)}</dd></div><div><dt>Size</dt><dd>${bytes(d.total_bytes)}</dd></div><div><dt>Uploaded</dt><dd>${when(d.created_at)}</dd></div><div><dt>By</dt><dd><code>${esc(d.created_by)}</code></dd></div>${d.manifest_sha256 ? `<div><dt>Manifest</dt><dd><code title="${esc(d.manifest_sha256)}">${esc(d.manifest_sha256.slice(0, 16))}</code></dd></div>` : ''}</dl></header>
${card('Upload log', `<ul class="hd-log">${logLines}</ul>`)}
${files.length ? card('Files', `<div class="hd-table-wrap"><table class="hd-table"><thead><tr><th>Path</th><th>Type</th><th class="hd-num">Size</th><th>sha256</th></tr></thead><tbody>${fileRows}</tbody></table></div>${files.length > 2000 ? `<p class="hd-muted">…and ${files.length - 2000} more.</p>` : ''}`, { sub: 'Stored once by content: a file that did not change since an earlier deploy of this project is not stored again.' }) : ''}`;
}

function errorPage({ status, message }) {
    return `<div class="hd-error">${icon(status === 404 ? 'fa-circle-question' : status === 403 ? 'fa-lock' : status === 401 ? 'fa-right-to-bracket' : 'fa-triangle-exclamation')}
<h1>${status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : status === 401 ? 'Sign in first' : 'Something went wrong'}</h1><p>${esc(message)}</p><p><a class="hd-btn" href="/dashboard">Back to your projects</a></p></div>`;
}

module.exports = { home, project, site, deploy, errorPage, bytes };
