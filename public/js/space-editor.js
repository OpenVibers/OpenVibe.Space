/* The space editor (server/spaces/render.js editorPage): files in tabs (CodeMirror when it loaded, a textarea when not),
   a live preview in a sandboxed frame (an opaque origin: the space's code never touches openvibe.space), the preview's
   SDK calls run through this page as the signed-in maker (POST /spaces/:slug/preview), AI changes (POST, then poll
   GET /spaces/:slug/ai), settings, publishing and deleting. Every call carries the form token in X-CSRF-Token. */
(function () {
  'use strict';
  var boot = JSON.parse(document.getElementById('sp-boot').textContent);
  var space = boot.space;
  var files = boot.files.map(function (f) { return { path: f.path, content: f.content }; });
  var current = files.some(function (f) { return f.path === 'index.html'; }) ? 'index.html' : (files[0] && files[0].path);
  var dirty = false;
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $('ed-status'), frame = $('ed-frame'), tabs = $('ed-tabs'), area = $('ed-code');
  var base = '/spaces/' + encodeURIComponent(space.slug);

  function status(text, kind) { statusEl.textContent = text || ''; statusEl.dataset.kind = kind || ''; }
  function call(method, path, body) {
    return fetch(base + path, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': boot.csrf }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error((j.error && j.error.message) || ('Request failed (' + r.status + ')')); e.code = j.error && j.error.code; e.status = r.status; throw e; }
        return j;
      }); });
  }

  // ── The code editor ──
  var cm = null;
  function modeOf(path) { return /\.css$/i.test(path) ? 'css' : /\.(m?js|json)$/i.test(path) ? 'javascript' : 'htmlmixed'; }
  if (window.CodeMirror) {
    cm = window.CodeMirror.fromTextArea(area, { lineNumbers: true, lineWrapping: true, tabSize: 2, indentUnit: 2, mode: 'htmlmixed', extraKeys: { 'Ctrl-S': function () { save(); }, 'Cmd-S': function () { save(); } } });
    cm.on('change', function (_, ch) { if (ch.origin !== 'setValue') edited(); });
  } else {
    area.addEventListener('input', edited);
  }
  function getText() { return cm ? cm.getValue() : area.value; }
  function setText(t, path) { if (cm) { cm.setOption('mode', modeOf(path)); cm.setValue(t); cm.clearHistory(); } else area.value = t; }
  function fileOf(path) { return files.find(function (f) { return f.path === path; }); }
  function stash() { var f = fileOf(current); if (f) f.content = getText(); }

  function renderTabs() {
    tabs.replaceChildren();
    files.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sp-ed-tab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', f.path === current ? 'true' : 'false');
      b.append(f.path);
      if (f.path !== 'index.html') {
        var x = document.createElement('span'); x.className = 'sp-ed-x'; x.textContent = '×'; x.title = 'Delete ' + f.path; x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Delete ' + f.path);
        x.addEventListener('click', function (e) { e.stopPropagation(); if (!confirm('Delete ' + f.path + '?')) return; stash(); files = files.filter(function (o) { return o !== f; }); if (current === f.path) open('index.html'); else renderTabs(); edited(); });
        b.append(x);
      }
      b.addEventListener('click', function () { open(f.path); });
      tabs.append(b);
    });
    var add = document.createElement('button');
    add.type = 'button'; add.className = 'sp-ed-tab'; add.textContent = '+ File'; add.title = 'Add a file';
    add.addEventListener('click', function () {
      var name = (prompt('File name (for example style.css or game.js)') || '').trim().replace(/^\/+/, '');
      if (!name) return;
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){0,3}$/.test(name)) { alert('Use letters, digits, ".", "-" and "_" (up to four folders).'); return; }
      if (fileOf(name)) { open(name); return; }
      stash(); files.push({ path: name, content: '' }); open(name); edited();
    });
    tabs.append(add);
  }
  function open(path) { stash(); current = path; var f = fileOf(path); setText(f ? f.content : '', path); renderTabs(); if (cm) cm.focus(); }

  // ── The preview ──
  var runTimer = null;
  function edited() { dirty = true; status('Unsaved changes'); clearTimeout(runTimer); runTimer = setTimeout(run, 1200); }
  /** index.html with the space's own scripts and stylesheets inlined (a srcdoc frame has no address to load them from). */
  function previewDoc() {
    stash();
    var index = (fileOf('index.html') || { content: '' }).content;
    var esc = function (s) { return s.replace(/<\/(script)/gi, '<\\/$1'); };
    return index
      .replace(/<script([^>]*?)\ssrc=["']\.?\/?([^"':]+)["']([^>]*)>\s*<\/script>/gi, function (m, a, src, b) {
        var f = fileOf(src); return f ? '<script' + a + b + '>' + esc(f.content) + '</script>' : m;
      })
      .replace(/<link([^>]*?)\shref=["']\.?\/?([^"':]+\.css)["']([^>]*)>/gi, function (m, a, href, b) {
        var f = fileOf(href); return f && /stylesheet/i.test(a + b) ? '<style>' + f.content + '</style>' : m;
      });
  }
  function run() { frame.srcdoc = previewDoc(); }
  $('ed-run').addEventListener('click', run);

  // The preview's SDK calls: only from our frame, answered to it.
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (ev.source !== frame.contentWindow || !d || d.ovSpacePreview !== 1 || typeof d.op !== 'string') return;
    var reply = function (msg) { try { frame.contentWindow.postMessage(Object.assign({ ovSpacePreview: 1, id: d.id }, msg), '*'); } catch (e) { /* the frame reloaded */ } };
    call('POST', '/preview', { op: d.op, args: d.args || {} })
      .then(function (j) { reply({ ok: true, result: j.result }); }, function (e) { reply({ ok: false, code: e.code || 'error', message: e.message }); });
  });

  // ── Saving ──
  function save() {
    stash();
    status('Saving…');
    return call('PUT', '/files', { files: files }).then(function () { dirty = false; status('Saved'); run(); }, function (e) { status(e.message, 'bad'); throw e; });
  }
  $('ed-save').addEventListener('click', function () { save().catch(function () {}); });
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save().catch(function () {}); } });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ── AI changes ──
  var overlay = $('ed-building');
  function building(on, text) { overlay.hidden = !on; $('ed-building-text').textContent = text ? '“' + text + '”' : ''; }
  function poll() {
    call('GET', '/ai').then(function (j) {
      if (j.status === 'running') return setTimeout(poll, 3000);
      building(false);
      if (j.status === 'done') {
        files = j.files.map(function (f) { return { path: f.path, content: f.content }; });
        space = Object.assign(space, j.space);
        $('ed-name').textContent = space.name; document.title = 'Edit ' + space.name;
        current = 'index.html'; setText(fileOf('index.html').content, 'index.html'); renderTabs();
        dirty = false; status('The AI changed your space'); run();
      } else if (j.status === 'failed') status(j.message || 'The AI could not do that', 'bad');
    }, function () { setTimeout(poll, 5000); });
  }
  $('ed-ai-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('ed-ai'), prompt = input.value.trim();
    if (!prompt) return;
    var go = function () {
      return call('POST', '/ai', { prompt: prompt }).then(function () { input.value = ''; building(true, prompt); setTimeout(poll, 3000); }, function (err) { status(err.message, 'bad'); });
    };
    if (dirty) save().then(go, function () {}); else go();
  });
  if (space.building) { building(true, space.building_prompt); setTimeout(poll, 1500); }

  // ── Settings ──
  var dialog = $('ed-dialog'), form = $('ed-settings-form');
  $('ed-settings').addEventListener('click', function () {
    form.elements.name.value = space.name || '';
    form.elements.description.value = space.description || '';
    form.elements.instructions.value = space.instructions || '';
    Array.prototype.forEach.call(form.querySelectorAll('input[name=cap]'), function (c) { c.checked = space.capabilities.indexOf(c.value) >= 0; });
    Array.prototype.forEach.call(form.querySelectorAll('input[name=visibility]'), function (r) { r.checked = r.value === (space.visibility || 'public'); });
    $('ed-unpublish').hidden = !space.published;
    dialog.showModal();
  });
  dialog.addEventListener('close', function () {
    if (dialog.returnValue !== 'save') return;
    var caps = Array.prototype.filter.call(form.querySelectorAll('input[name=cap]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    var vis = form.querySelector('input[name=visibility]:checked');
    call('PUT', '/settings', { name: form.elements.name.value, description: form.elements.description.value, instructions: form.elements.instructions.value, capabilities: caps, visibility: vis ? vis.value : 'public' })
      .then(function (j) { space = Object.assign(space, j.space); $('ed-name').textContent = space.name; status('Settings saved'); }, function (e) { status(e.message, 'bad'); });
  });

  // ── Publishing ──
  var publishBtn = $('ed-publish');
  function publishLabel() { publishBtn.lastChild.textContent = space.published ? ' Update' : ' Publish'; }
  publishBtn.addEventListener('click', function () {
    var go = function () {
      status('Publishing…');
      return call('POST', '/publish').then(function (j) {
        space = Object.assign(space, j.space); publishLabel();
        statusEl.replaceChildren('Live at ');
        var a = document.createElement('a'); a.href = j.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = j.url.replace(/^https?:\/\//, ''); statusEl.append(a);
      }, function (e) { status('', ''); alert(e.message); });
    };
    if (dirty) save().then(go, function () {}); else go();
  });
  $('ed-unpublish').addEventListener('click', function () {
    if (!confirm('Unpublish? Its address stops working until you publish again.')) return;
    call('POST', '/unpublish').then(function (j) { space = Object.assign(space, j.space); publishLabel(); dialog.close(); status('Unpublished'); }, function (e) { alert(e.message); });
  });
  $('ed-delete').addEventListener('click', function () {
    if (!confirm('Delete "' + space.name + '" for good? Its files, lists and everyone\'s saved data in it go too.')) return;
    call('POST', '/delete').then(function () { dirty = false; location.href = '/spaces/mine'; }, function (e) { alert(e.message); });
  });
  if (!boot.canPublish) publishBtn.title = 'Publishing at its own address opens with OpenVibe.Space\'s public hosting; the preview runs it now.';

  // Phone: the Preview / Code switch (desktop shows both side by side and hides it).
  var editorEl = $('sp-editor');
  Array.prototype.forEach.call(document.querySelectorAll('.sp-ed-switch button'), function (b) {
    b.addEventListener('click', function () {
      editorEl.dataset.view = b.dataset.view;
      Array.prototype.forEach.call(document.querySelectorAll('.sp-ed-switch button'), function (o) { o.setAttribute('aria-selected', o === b ? 'true' : 'false'); });
      if (b.dataset.view === 'code' && cm) setTimeout(function () { cm.refresh(); cm.focus(); }, 0);
      if (b.dataset.view === 'preview' && dirty) run();
    });
  });

  setText((fileOf(current) || { content: '' }).content, current);
  renderTabs();
  run();
})();
