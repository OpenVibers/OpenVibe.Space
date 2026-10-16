'use strict';
/**
 * The space SDK (window.OV), served at /_openvibe/sdk.js:
 *
 *   on a published space's own address   "live": the visitor signs in through openvibe.space (a redirect to the
 *                                         connect page and back with a one-time code, PKCE S256), the token is kept
 *                                         in sessionStorage on the space's origin, and calls go to Space's API
 *                                         (POST /api/v1/apps/:id/run) from that origin.
 *   on openvibe.space itself              "preview": the editor runs the space's files in a sandboxed frame (an opaque
 *                                         origin with no storage), so every call is a postMessage to the editor,
 *                                         which runs it as the signed-in maker.
 *
 * OV.fn(name, body) runs the space's functions/<name>.js (server/spaces/functions.js): at /api/<name> on the space's
 * own address when live, through the editor (its unsaved copy) in the preview.
 *
 * The API is the one the AI builder is told about (OpenVibe.AI server/workflows/space.js SDK_REFERENCE).
 */
const SDK = String.raw`(function () {
  'use strict';
  var CFG = __CONFIG__;
  if (window.OV && window.OV.__space) return;
  var listeners = [];
  var OV = { __space: true, version: 1, space: { id: CFG.id, slug: CFG.slug, name: CFG.name }, user: null, preview: CFG.mode === 'preview' };
  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](OV.user); } catch (e) { setTimeout(function () { throw e; }); } } }
  function setUser(u) { OV.user = u ? { username: u.username, display_name: u.display_name || u.username, avatar_url: CFG.avatar.replace('{username}', encodeURIComponent(u.username)) } : null; emit(); }
  function fail(code, message) { var e = new Error(message || code); e.code = code; return e; }
  OV.on = function (name, fn) { if (name === 'user' && typeof fn === 'function') listeners.push(fn); return OV; };

  var call, fnCall;
  if (CFG.mode === 'preview') {
    var seq = 0, waiting = {};
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (ev.source !== window.parent || !d || d.ovSpacePreview !== 1 || !waiting[d.id]) return;
      var w = waiting[d.id]; delete waiting[d.id];
      if (d.ok) w.resolve(d.result); else w.reject(fail(d.code || 'error', d.message));
    });
    call = function (op, args) {
      return new Promise(function (resolve, reject) {
        var id = ++seq; waiting[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ ovSpacePreview: 1, id: id, op: op, args: args || {} }, '*');
      });
    };
    fnCall = function (name, method, body, query) {
      return call('fn.call', { name: name, method: method, body: method === 'POST' ? body : undefined, query: query })
        .then(function (r) { return fnResult(r.status, r.headers && r.headers['content-type'], r.body); });
    };
    OV.signIn = function () { return call('me').then(function (u) { setUser(u); return u; }); };
    OV.signOut = function () { setUser(null); return Promise.resolve(); };
    OV.ready = call('me').then(function (u) { setUser(u); return u; }, function () { return null; });
  } else {
    var KEY = 'ov_space_' + CFG.id;
    var store = { get: function (k) { try { return sessionStorage.getItem(KEY + k); } catch (e) { return null; } },
      set: function (k, v) { try { sessionStorage.setItem(KEY + k, v); } catch (e) { /* storage blocked: signed in for this page only */ } },
      del: function (k) { try { sessionStorage.removeItem(KEY + k); } catch (e) { /* */ } } };
    var memToken = null;
    function token() { return memToken || store.get(':token'); }
    function b64url(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function random() { var a = new Uint8Array(32); crypto.getRandomValues(a); return b64url(a); }
    function api(path, method, body) {
      var headers = { 'Content-Type': 'application/json' };
      var t = token(); if (t) headers.Authorization = 'Bearer ' + t;
      return fetch(CFG.api + '/api/v1/apps/' + CFG.id + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', mode: 'cors' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          var err = (j && j.error) || {};
          var code = err.code || (r.status === 401 ? 'auth.required' : r.status === 429 ? 'quota' : 'error');
          if (r.status === 401 && t) { memToken = null; store.del(':token'); store.del(':user'); setUser(null); }
          throw fail(code, err.message || ('Request failed (' + r.status + ')'));
        }); }, function () { throw fail('network', 'Could not reach OpenVibe. Check the connection and try again.'); });
    }
    call = function (op, args) { return api('/run', 'POST', { op: op, args: args || {} }).then(function (j) { return j.result; }); };
    // The space's own functions answer on its own address (/api/<name>), with the visitor's token when signed in.
    fnCall = function (name, method, body, query) {
      var headers = {}; var t = token(); if (t) headers.Authorization = 'Bearer ' + t;
      if (method === 'POST') headers['Content-Type'] = 'application/json';
      var qs = query ? '?' + new URLSearchParams(query).toString() : '';
      return fetch('/api/' + name + qs, { method: method, headers: headers, body: method === 'POST' ? JSON.stringify(body === undefined ? null : body) : undefined, credentials: 'omit' })
        .then(function (r) { return r.text().then(function (text) { return fnResult(r.status, r.headers.get('content-type'), text); }); },
          function () { throw fail('network', 'Could not reach the space. Check the connection and try again.'); });
    };
    OV.signIn = function () {
      var verifier = random(), state = random();
      store.set(':verifier', verifier); store.set(':state', state);
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (d) {
        var back = location.pathname + location.search;
        location.href = CFG.api + '/spaces/' + CFG.slug + '/connect?challenge=' + b64url(new Uint8Array(d)) + '&state=' + encodeURIComponent(state) + '&return=' + encodeURIComponent(back);
        return new Promise(function () {});
      });
    };
    OV.signOut = function () {
      var p = token() ? api('/token', 'DELETE').catch(function () {}) : Promise.resolve();
      memToken = null; store.del(':token'); store.del(':user'); setUser(null);
      return p.then(function () {});
    };
    OV.ready = (function () {
      var m = /[#&]ov_code=([A-Za-z0-9_-]+)&ov_state=([A-Za-z0-9_%-]+)/.exec(location.hash);
      if (m) {
        history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/[#&]?ov_code=[^&]*&ov_state=[^&]*/, '').replace(/^#?$/, ''));
        var verifier = store.get(':verifier'), state = store.get(':state');
        store.del(':verifier'); store.del(':state');
        if (verifier && state && decodeURIComponent(m[2]) === state) {
          return api('/token', 'POST', { code: m[1], code_verifier: verifier }).then(function (j) {
            memToken = j.token; store.set(':token', j.token); store.set(':user', JSON.stringify(j.user)); setUser(j.user); return OV.user;
          }, function () { setUser(null); return null; });
        }
      }
      var saved = store.get(':user');
      if (token() && saved) { try { setUser(JSON.parse(saved)); } catch (e) { setUser(null); } }
      return Promise.resolve(OV.user);
    })();
  }

  function named(kind, v) { if (typeof v !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(v)) throw fail('space.invalid_name', kind + ' names are 1-64 characters: letters, digits, ".", "-" and "_"'); return v; }
  function guard(fn) { return function () { try { return fn.apply(null, arguments); } catch (e) { return Promise.reject(e); } }; }
  OV.items = {
    list: guard(function (c, o) { o = o || {}; return call('items.list', { collection: named('collection', c), limit: o.limit, before: o.before }); }),
    add: guard(function (c, value) { return call('items.add', { collection: named('collection', c), value: value }); }),
    set: guard(function (c, value) { return call('items.set', { collection: named('collection', c), value: value }); }),
    remove: guard(function (c, id) { return call('items.remove', { collection: named('collection', c), id: String(id) }); }),
  };
  OV.kv = {
    get: guard(function (k) { return call('kv.get', { key: named('key', k) }); }),
    set: guard(function (k, value) { return call('kv.set', { key: named('key', k), value: value }); }),
    remove: guard(function (k) { return call('kv.remove', { key: named('key', k) }); }),
  };
  function fnResult(status, type, text) {
    var value = text;
    if (/application\/json/i.test(type || '')) { try { value = JSON.parse(text); } catch (e) { /* keep the text */ } }
    if (status >= 400) {
      var e = fail(status === 429 ? 'quota' : 'fn.failed', typeof value === 'string' && value ? value.slice(0, 300) : 'The function failed (' + status + ')');
      e.status = status; e.body = value; throw e;
    }
    return status === 204 ? null : value;
  }
  // OV.fn(name[, body][, { method, query }]): run functions/<name>.js on the server (POST when there is a body).
  OV.fn = guard(function (name, body, o) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw fail('space.invalid_name', 'function names are 1-40 characters: a-z, 0-9 and "-"');
    o = o || {};
    var method = String(o.method || (body === undefined ? 'GET' : 'POST')).toUpperCase() === 'POST' ? 'POST' : 'GET';
    return fnCall(name, method, body, o.query || null);
  });
  OV.ai = { ask: function (input) { return call('ai.ask', { input: input }).then(function (r) { return r.text; }); } };
  OV.me = function () { return call('me'); };
  window.OV = OV;
})();
`;

/** The SDK for a space (live) or for the editor's preview frame. */
function sdkSource({ mode = 'live', space = null, api = '', avatar = '' } = {}) {
    const cfg = {
        mode, api, avatar,
        id: space ? space.id : 'preview', slug: space ? space.slug : 'preview', name: space ? space.name : 'Preview',
    };
    return SDK.replace('__CONFIG__', JSON.stringify(cfg).replace(/</g, '\\u003c'));
}

module.exports = { sdkSource };
