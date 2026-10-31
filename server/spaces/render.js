'use strict';
/**
 * Pages of spaces on openvibe.space: the gallery (/spaces), making one (/spaces/new), your spaces (/spaces/mine), a
 * space's page (/spaces/:slug), its editor (/spaces/:slug/edit) and the sign-in a visitor approves (/spaces/:slug/connect).
 * Plain template strings, every value escaped; the editor's behaviour is public/js/space-editor.js.
 */
const sc = require('openvibe-shared/showcase');
const { renderPage, escapeHtml: esc, asset } = require('../render/layout');

const CAP_TEXT = {
    profile: { icon: 'fa-user', text: 'Know who you are: your username and display name' },
    data: { icon: 'fa-list', text: 'Add things you write to its shared lists, under your name' },
    kv: { icon: 'fa-box-archive', text: 'Keep your own private data in this space' },
    ai: { icon: 'fa-wand-magic-sparkles', text: 'Ask OpenVibe AI for you (it counts against your daily AI allowance)' },
};
const caps = (s) => { try { return JSON.parse(s.capabilities || '[]'); } catch { return []; } };
const ago = (ms) => {
    const s = Math.max(1, (Date.now() - Number(ms)) / 1000);
    const u = [[86400 * 365, 'y'], [86400 * 30, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']].find(([n]) => s >= n);
    return u ? `${Math.floor(s / u[0])}${u[1]} ago` : 'just now';
};

function page(o) {
    return renderPage({
        title: o.title, description: o.description, canonicalPath: o.path, robots: o.robots || 'index,follow',
        active: 'spaces', styles: o.showcase ? [sc.STYLESHEET] : [], localStyles: ['css/spaces.css'], body: o.body, jsonLd: o.jsonLd,
    });
}

const signInHref = (next) => `/auth/login?next=${encodeURIComponent(next)}`;
const capList = (list) => `<ul class="sp-caps">${list.filter((c) => CAP_TEXT[c]).map((c) => `<li><i class="fa-solid ${CAP_TEXT[c].icon}" aria-hidden="true"></i> ${esc(CAP_TEXT[c].text)}</li>`).join('')}</ul>`;

function card(s, { mine = false } = {}) {
    const live = Boolean(s.site_id);
    return `<article class="sp-card">
  <a class="sp-card-main" href="/spaces/${esc(s.slug)}">
    <span class="sp-card-badge ${live ? 'is-live' : ''}">${live ? (s.visibility === 'unlisted' ? 'Unlisted' : 'Published') : 'Draft'}</span>
    <h3>${esc(s.name)}</h3>
    <p>${esc(s.description || 'No description yet.')}</p>
  </a>
  <footer><span>${mine ? `edited ${esc(ago(s.updated_at))}` : `by @${esc(s.owner_username || 'someone')}`}</span>${s.forks ? `<span><i class="fa-solid fa-code-fork" aria-hidden="true"></i> ${Number(s.forks)}</span>` : ''}</footer>
</article>`;
}

function templateCards(templates, { viewer, csrf, compact = false }) {
    return `<div class="sp-templates ${compact ? 'is-compact' : ''}">${templates.map((t) => `<div class="sp-template" style="--tpl:${esc(t.accent)}">
  <span class="sp-template-icon"><i class="fa-solid ${esc(t.icon)}" aria-hidden="true"></i></span>
  <h3>${esc(t.name)}</h3><p>${esc(t.description)}</p>
  ${viewer ? `<form method="post" action="/spaces/new"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="template" value="${esc(t.id)}"><button class="sp-btn">Start from this</button></form>`
        : `<a class="sp-btn" href="${signInHref('/spaces/new')}">Sign in to start</a>`}
</div>`).join('')}</div>`;
}

function galleryPage({ viewer, spaces, templates, q, sort, csrf }) {
    const hero = sc.hero({
        eyebrow: 'OpenVibe.Space · spaces',
        title: 'Make a space.',
        accent: 'An app on your OpenVibe account.',
        lede: 'Describe it and OpenVibe AI builds it, or start from a template and change anything in the editor. Spaces sign visitors in with OpenVibe, keep shared lists and private data, talk to OpenVibe AI and run their own server code.',
        actions: [
            { label: 'Make a space', href: viewer ? '/spaces/new' : signInHref('/spaces/new'), primary: true, icon: 'fa-wand-magic-sparkles' },
            ...(viewer ? [{ label: 'Your spaces', href: '/spaces/mine', icon: 'fa-shapes' }] : []),
        ],
    });
    const list = spaces.length ? `<div class="sp-grid">${spaces.map((s) => card(s)).join('')}</div>`
        : `<p class="sp-empty">${q ? `No published space matches “${esc(q)}”.` : 'Published spaces appear here. Start one from a template below and run it in the editor right away.'}</p>`;
    const body = `${hero}
<section class="sp-section" aria-labelledby="sp-gallery">
  <div class="sp-head">
    <h2 id="sp-gallery">Spaces people made</h2>
    <form class="sp-search" method="get" action="/spaces" role="search">
      <input name="q" value="${esc(q || '')}" placeholder="Search spaces" aria-label="Search spaces" maxlength="80">
      <select name="sort" aria-label="Sort"><option value="new"${sort !== 'popular' ? ' selected' : ''}>Newest</option><option value="popular"${sort === 'popular' ? ' selected' : ''}>Most forked</option></select>
      <button class="sp-btn sp-btn-quiet">Search</button>
    </form>
  </div>
  ${list}
</section>
<section class="sp-section" aria-labelledby="sp-starters">
  <div class="sp-head"><h2 id="sp-starters">Start from a template</h2><p>Each one is a working app you can change line by line.</p></div>
  ${templateCards(templates, { viewer, csrf })}
</section>
<section class="sp-section sp-how" aria-labelledby="sp-how">
  <h2 id="sp-how">What a space can do</h2>
  <div class="sp-how-grid">
    <div><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i><h3>Sign in with OpenVibe</h3><p>Visitors sign in with their OpenVibe account and approve what the space may do, once.</p></div>
    <div><i class="fa-solid fa-list" aria-hidden="true"></i><h3>Shared lists</h3><p>Guestbooks, polls, leaderboards: things visitors add, under their name, that everyone can read.</p></div>
    <div><i class="fa-solid fa-box-archive" aria-hidden="true"></i><h3>Private storage</h3><p>Each visitor's own data in your space: to-dos, saves, settings.</p></div>
    <div><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><h3>OpenVibe AI</h3><p>Give your space an AI with your own instructions; it answers your visitors.</p></div>
  </div>
  <p class="sp-note">Spaces are plain HTML, CSS and JavaScript with the space SDK (<code>/_openvibe/sdk.js</code>). The AI builder, the editor and the preview work for everyone signed in. Publishing a space at its own address opens together with OpenVibe.Space's public hosting.</p>
</section>`;
    return page({ title: 'Spaces', description: 'Make a space: a small app on your OpenVibe account, built by OpenVibe AI or from a template, with sign-in, shared lists, private storage and AI.', path: '/spaces', showcase: true, body });
}

function newPage({ viewer, templates, csrf, error, prompt, aiOn, buildsLeft, pick = null }) {
    const picked = pick ? `<section class="sp-pick" style="--tpl:${esc(pick.accent)}" aria-labelledby="sp-pick-h">
  <span class="sp-template-icon"><i class="fa-solid ${esc(pick.icon)}" aria-hidden="true"></i></span>
  <div class="sp-pick-text"><p class="eyebrow">The template you picked</p><h2 id="sp-pick-h">${esc(pick.name)}</h2><p>${esc(pick.description)}</p></div>
  <form method="post" action="/spaces/new"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="template" value="${esc(pick.id)}"><button class="sp-btn">Start from this</button></form>
</section>` : '';
    const body = `<div class="sp-wrap">
  <p class="eyebrow">New space</p>
  <h1 class="sp-title">${pick ? 'Make it yours' : 'What do you want to make?'}</h1>
  ${error ? `<p class="sp-flash is-bad" role="alert">${esc(error)}</p>` : ''}
  ${picked}
  <form class="sp-ai-form" method="post" action="/spaces/new">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <label for="sp-prompt">Describe it and OpenVibe AI builds it</label>
    <textarea id="sp-prompt" name="prompt" rows="4" maxlength="4000" placeholder="A trivia quiz about 90s cartoons with a leaderboard…" ${aiOn ? '' : 'disabled'}>${esc(prompt || '')}</textarea>
    <div class="sp-row"><button class="sp-btn" ${aiOn ? '' : 'disabled'}><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Build it</button>
      <span class="sp-muted">${aiOn ? `${Number(buildsLeft)} AI builds left today. It takes about a minute; you can change everything after.` : 'OpenVibe AI is not available right now; start from a template instead.'}</span></div>
    <div class="sp-ideas" aria-label="Ideas">${['A daily mood check-in with a shared chart', 'A pixel art board everyone can paint on', 'A recipe idea generator that asks what is in my fridge', 'A study flashcard deck I can quiz myself with'].map((i) => `<button type="button" class="sp-chip" data-idea="${esc(i)}">${esc(i)}</button>`).join('')}</div>
  </form>
  <h2 class="sp-subtitle">Or start from a template</h2>
  ${templateCards(templates, { viewer, csrf, compact: true })}
</div>
<script>document.querySelectorAll('.sp-chip').forEach(function (b) { b.addEventListener('click', function () { var t = document.getElementById('sp-prompt'); t.value = b.getAttribute('data-idea'); t.focus(); }); });</script>`;
    return page({ title: 'New space', path: '/spaces/new', robots: 'noindex,nofollow', body });
}

function minePage({ spaces }) {
    const body = `<div class="sp-wrap">
  <div class="sp-head"><h1 class="sp-title">Your spaces</h1><a class="sp-btn" href="/spaces/new"><i class="fa-solid fa-plus" aria-hidden="true"></i> New space</a></div>
  ${spaces.length ? `<div class="sp-grid">${spaces.map((s) => card(s, { mine: true })).join('')}</div>` : '<p class="sp-empty">You have not made a space yet. <a href="/spaces/new">Make your first one</a>: describe it, or start from a template.</p>'}
</div>`;
    return page({ title: 'Your spaces', path: '/spaces/mine', robots: 'noindex,nofollow', body });
}

function spacePage({ viewer, space, owner, url, csrf, forkedFrom }) {
    const live = Boolean(space.site_id);
    const actions = [
        live ? `<a class="sp-btn" href="${esc(url)}" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Open</a>` : '',
        owner ? `<a class="sp-btn ${live ? 'sp-btn-quiet' : ''}" href="/spaces/${esc(space.slug)}/edit"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit</a>` : '',
        viewer ? `<form method="post" action="/spaces/${esc(space.slug)}/fork"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="sp-btn sp-btn-quiet"><i class="fa-solid fa-code-fork" aria-hidden="true"></i> Fork</button></form>`
            : `<a class="sp-btn sp-btn-quiet" href="${signInHref(`/spaces/${space.slug}`)}"><i class="fa-solid fa-code-fork" aria-hidden="true"></i> Sign in to fork</a>`,
    ].join('');
    const body = `<div class="sp-wrap">
  <p class="eyebrow">${live ? 'Space' : 'Draft space'}</p>
  <div class="sp-head"><h1 class="sp-title">${esc(space.name)}</h1><div class="sp-actions">${actions}</div></div>
  <p class="sp-lede">${esc(space.description || 'No description yet.')}</p>
  <p class="sp-muted">by <a href="https://openvibe.network/@${esc(encodeURIComponent(space.owner_username))}">@${esc(space.owner_username)}</a>${forkedFrom ? ` · forked from <a href="/spaces/${esc(forkedFrom.slug)}">${esc(forkedFrom.name)}</a>` : ''}${space.forks ? ` · ${Number(space.forks)} fork${space.forks === 1 ? '' : 's'}` : ''}${live ? ` · <a href="${esc(url)}">${esc(url.replace(/^https?:\/\//, ''))}</a>` : ''}</p>
  ${live ? `<div class="sp-frame"><iframe src="${esc(url)}" title="${esc(space.name)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"></iframe></div>`
        : `<p class="sp-flash">This space is a draft: only its maker can open it, in the editor.</p>`}
  <h2 class="sp-subtitle">What it can do when you sign in</h2>
  ${capList(caps(space)) || '<p class="sp-muted">Nothing: it does not use your account.</p>'}
</div>`;
    return page({
        title: space.name, description: space.description || `${space.name}: a space on OpenVibe.Space by @${space.owner_username}.`, path: `/spaces/${space.slug}`,
        robots: live && space.visibility === 'public' ? 'index,follow' : 'noindex,nofollow', body,
        jsonLd: live ? { '@context': 'https://schema.org', '@type': 'WebApplication', name: space.name, url, description: space.description || undefined, applicationCategory: 'WebApplication', author: { '@type': 'Person', name: space.owner_username } } : undefined,
    });
}

function editorPage({ space, files, csrf, canPublish, url, aiOn, buildsLeft, templates, guest = null }) {
    const boot = {
        space: { id: space.id, slug: space.slug, name: space.name, description: space.description, instructions: space.instructions, capabilities: caps(space), visibility: space.visibility, published: Boolean(space.site_id), url, building: Boolean(space.building_run_id), building_prompt: space.building_prompt || '' },
        files, csrf, canPublish, aiOn, buildsLeft, templates: templates.map((t) => ({ id: t.id, name: t.name })),
        // Where the editor's calls go: a guest draft is edited by its id (its address is a secret link), an
        // owned space by its slug. A guest carries its secret with every call.
        base: `/spaces/${guest ? space.id : space.slug}`,
        guest: guest ? { id: space.id, key: guest.key } : null,
    };
    // The claim (openvibe.website, plan 5.9): a signed-in person who holds the secret keeps the draft.
    const claim = guest ? (guest.signedIn
        ? `<form method="post" action="/spaces/${esc(guest.id)}/claim"><input type="hidden" name="key" value="${esc(guest.key)}"><input type="hidden" name="csrf" value="${esc(guest.claimCsrf || '')}"><button class="sp-btn" type="submit"><i class="fa-solid fa-bookmark" aria-hidden="true"></i> Keep this site</button></form>`
        : `<p class="sp-muted">This draft is yours until you sign in. <a class="sp-btn sp-btn-quiet" href="${esc(`/auth/login?next=${encodeURIComponent(`/spaces/${guest.id}/edit?key=${guest.key}`)}`)}">Sign in to keep it</a></p>`) : '';
    const body = `<div class="sp-editor" id="sp-editor" data-view="preview">
  <header class="sp-ed-bar">
    <a class="sp-ed-back" href="${guest ? '/spaces/guest' : `/spaces/${esc(space.slug)}`}" aria-label="Back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></a>
    <h1 class="sp-ed-name" id="ed-name">${esc(space.name)}</h1>
    <span class="sp-ed-status" id="ed-status" role="status"></span>
    <div class="sp-ed-actions">
      <button class="sp-btn sp-btn-quiet" id="ed-settings" type="button"><i class="fa-solid fa-sliders" aria-hidden="true"></i> Settings</button>
      <button class="sp-btn sp-btn-quiet" id="ed-save" type="button"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save</button>
      ${guest ? '' : `<button class="sp-btn" id="ed-publish" type="button"><i class="fa-solid fa-globe" aria-hidden="true"></i> ${space.site_id ? 'Update' : 'Publish'}</button>`}
    </div>
  </header>
  ${claim ? `<div class="sp-ed-claim"><p><strong>Keep this site</strong> — sign in and it becomes yours, with an address of its own.</p>${claim}</div>` : ''}
  <div class="sp-ed-ai">
    <form id="ed-ai-form"><label class="sr-only" for="ed-ai">Ask OpenVibe AI to change this space</label>
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      <input id="ed-ai" maxlength="4000" autocomplete="off" placeholder="${aiOn ? 'Ask AI to change it: “make the buttons bigger and add a dark mode toggle”' : 'OpenVibe AI is not available right now'}" ${aiOn ? '' : 'disabled'}>
      <button class="sp-btn" ${aiOn ? '' : 'disabled'}>Change</button></form>
  </div>
  <div class="sp-ed-switch" role="tablist" aria-label="Show"><button type="button" role="tab" data-view="preview" aria-selected="true"><i class="fa-solid fa-eye" aria-hidden="true"></i> Preview</button><button type="button" role="tab" data-view="code" aria-selected="false"><i class="fa-solid fa-code" aria-hidden="true"></i> Code</button></div>
  <div class="sp-ed-main">
    <section class="sp-ed-code" aria-label="Files">
      <div class="sp-ed-tabs" id="ed-tabs" role="tablist"></div>
      <textarea id="ed-code" spellcheck="false" aria-label="File contents"></textarea>
    </section>
    <section class="sp-ed-preview" aria-label="Preview">
      <div class="sp-ed-preview-bar"><span><i class="fa-solid fa-eye" aria-hidden="true"></i> Preview <span class="sp-muted">(runs as you)</span></span><button class="sp-btn sp-btn-quiet sp-btn-sm" id="ed-run" type="button"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Run</button></div>
      <iframe id="ed-frame" title="Preview of the space" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"></iframe>
      <details class="sp-ed-fnlog" id="ed-fnlog" hidden><summary><i class="fa-solid fa-terminal" aria-hidden="true"></i> Function log <span class="sp-muted" id="ed-fnlog-last"></span></summary><ol id="ed-fnlog-list"></ol></details>
    </section>
  </div>
  <div class="sp-ed-building" id="ed-building" hidden><div><i class="fa-solid fa-wand-magic-sparkles fa-bounce" aria-hidden="true"></i><h2>OpenVibe AI is building…</h2><p id="ed-building-text"></p><p class="sp-muted">This usually takes under a minute or two. You can leave and come back.</p></div></div>
  <dialog class="sp-ed-dialog" id="ed-dialog">
    <form method="dialog" id="ed-settings-form">
      <h2>Settings</h2>
      <label>Name<input name="name" maxlength="40" required></label>
      <label>Description<textarea name="description" rows="2" maxlength="400" placeholder="What it does, for the gallery"></textarea></label>
      <label>Its AI's instructions<textarea name="instructions" rows="4" maxlength="4000" placeholder="Who the space's AI is and how it answers (used by OV.ai.ask)"></textarea></label>
      ${guest ? '' : `<fieldset><legend>What it may ask visitors for</legend>
        <label class="sp-check"><input type="checkbox" name="cap" value="profile"> Their username</label>
        <label class="sp-check"><input type="checkbox" name="cap" value="data"> Adding to shared lists (OV.items)</label>
        <label class="sp-check"><input type="checkbox" name="cap" value="kv"> Their private storage (OV.kv)</label>
        <label class="sp-check"><input type="checkbox" name="cap" value="ai"> OpenVibe AI for them (OV.ai)</label>
      </fieldset>
      <fieldset><legend>Who can find it</legend>
        <label class="sp-check"><input type="radio" name="visibility" value="public"> Public: in the gallery</label>
        <label class="sp-check"><input type="radio" name="visibility" value="unlisted"> Unlisted: only with its link</label>
      </fieldset>`}
      <div class="sp-row sp-dialog-actions"><button class="sp-btn" value="save">Save settings</button><button class="sp-btn sp-btn-quiet" value="cancel" formnovalidate>Cancel</button></div>
      <hr>
      <div class="sp-row">${guest ? '' : `<button class="sp-btn sp-btn-quiet sp-btn-sm" id="ed-unpublish" type="button" ${space.site_id ? '' : 'hidden'}>Unpublish</button>`}<button class="sp-btn sp-btn-danger sp-btn-sm" id="ed-delete" type="button">Delete this space</button></div>
    </form>
  </dialog>
</div>
<script type="application/json" id="sp-boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/xml/xml.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/css/css.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/htmlmixed/htmlmixed.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="${asset('js/space-editor.js')}" defer></script>`;
    return page({ title: `Edit ${space.name}`, path: guest ? `/spaces/${space.id}/edit` : `/spaces/${space.slug}/edit`, robots: 'noindex,nofollow', body });
}

/**
 * The start page of a guest draft (openvibe.website, plan 5.9): no account, a template or a sentence, and a
 * private link to edit it. Plain forms in the spaces markup; the design is the orchestrator's.
 */
function guestPage({ templates, error, prompt, aiOn, pick = null }) {
    const picked = pick ? `<section class="sp-pick" style="--tpl:${esc(pick.accent)}" aria-labelledby="sp-pick-h">
  <span class="sp-template-icon"><i class="fa-solid ${esc(pick.icon)}" aria-hidden="true"></i></span>
  <div class="sp-pick-text"><p class="eyebrow">The template you picked</p><h2 id="sp-pick-h">${esc(pick.name)}</h2><p>${esc(pick.description)}</p></div>
  <form method="post" action="/spaces/guest"><input type="hidden" name="template" value="${esc(pick.id)}"><button class="sp-btn">Start from this</button></form>
</section>` : '';
    const cards = templates.map((t) => `<div class="sp-template" style="--tpl:${esc(t.accent)}">
  <span class="sp-template-icon"><i class="fa-solid ${esc(t.icon)}" aria-hidden="true"></i></span>
  <h3>${esc(t.name)}</h3><p>${esc(t.description)}</p>
  <form method="post" action="/spaces/guest"><input type="hidden" name="template" value="${esc(t.id)}"><button class="sp-btn">Start from this</button></form>
</div>`).join('');
    const body = `<div class="sp-wrap">
  <p class="eyebrow">OpenVibe.Space</p>
  <h1 class="sp-title">Make a site.</h1>
  <p class="sp-lede">No account needed. Start from a template or describe what you want and OpenVibe AI writes it. You get a private link to edit it; sign in later to keep it.</p>
  ${error ? `<p class="sp-flash is-bad" role="alert">${esc(error)}</p>` : ''}
  ${picked}
  <form class="sp-ai-form" method="post" action="/spaces/guest">
    <label for="sp-prompt">Describe it and OpenVibe AI builds it</label>
    <textarea id="sp-prompt" name="prompt" rows="4" maxlength="4000" placeholder="A bakery site with today&rsquo;s hours, where to find us and how to order…" ${aiOn ? '' : 'disabled'}>${esc(prompt || '')}</textarea>
    <div class="sp-row"><button class="sp-btn" ${aiOn ? '' : 'disabled'}><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Build it</button>
      <span class="sp-muted">${aiOn ? 'It takes about a minute; you can change everything after.' : 'OpenVibe AI is not available right now; start from a template instead.'}</span></div>
  </form>
  <h2 class="sp-subtitle">Or start from a template</h2>
  <div class="sp-templates is-compact">${cards}</div>
</div>`;
    return page({ title: 'Make a site', path: '/spaces/guest', robots: 'noindex,nofollow', body });
}

function connectPage({ viewer, space, csrf, challenge, state, returnPath }) {
    const u = viewer.user || {};
    const body = `<div class="sp-wrap sp-connect">
  <div class="sp-connect-card">
    <p class="eyebrow">Sign in to a space</p>
    <h1 class="sp-title">${esc(space.name)}</h1>
    <p class="sp-muted">by @${esc(space.owner_username)} · ${esc(`${space.slug}`)}.openvibe.website</p>
    <p>Signed in as <strong>${esc(u.display_name || u.username || 'you')}</strong>. If you continue, this space may:</p>
    ${capList(caps(space).length ? caps(space) : ['profile'])}
    <p class="sp-muted">It never sees your password or your OpenVibe session, and the sign-in lasts a day. Spaces are made by people on OpenVibe, not by OpenVibe.</p>
    <form method="post" action="/spaces/${esc(space.slug)}/connect" class="sp-row">
      <input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="challenge" value="${esc(challenge)}">
      <input type="hidden" name="state" value="${esc(state)}"><input type="hidden" name="return" value="${esc(returnPath)}">
      <button class="sp-btn" name="decision" value="allow">Continue</button>
      <button class="sp-btn sp-btn-quiet" name="decision" value="deny">Cancel</button>
    </form>
  </div>
</div>`;
    return page({ title: `Sign in to ${space.name}`, path: `/spaces/${space.slug}/connect`, robots: 'noindex,nofollow', body });
}

/**
 * A gated page's answer on this origin (audit SEO-7): noindex, a canonical to the page itself, and a link
 * to Network sign-in. Never a redirect to sign-in, which handed a crawler openvibe.network's canonical.
 */
function signInPage({ path, next, title = 'Sign in to continue' }) {
    const body = `<div class="sp-wrap">
  <p class="eyebrow">OpenVibe.Space</p>
  <h1 class="sp-title">${esc(title)}</h1>
  <p class="sp-lede">Spaces are made with your OpenVibe account. Sign in and you come straight back here.</p>
  <p><a class="sp-btn" href="${esc(signInHref(next))}">Sign in with OpenVibe</a></p>
</div>`;
    return page({ title, path, robots: 'noindex,nofollow', body });
}

function errorBody(status, message) {
    return page({ title: status === 404 ? 'Space not found' : 'Spaces', path: '/spaces', robots: 'noindex,nofollow', body: `<div class="sp-wrap"><p class="eyebrow">Error ${Number(status)}</p><h1 class="sp-title">${status === 404 ? 'No such space' : 'That did not work'}</h1><p class="sp-lede">${esc(message)}</p><p><a class="sp-btn" href="/spaces">Back to spaces</a></p></div>` });
}

module.exports = { galleryPage, newPage, minePage, spacePage, editorPage, guestPage, connectPage, signInPage, errorBody, CAP_TEXT };
