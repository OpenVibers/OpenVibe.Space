/* OpenVibe.Space — progressive enhancement. Every page works without this file: the board index,
   spaces, threads and posts are server-rendered, and every action (reply, vote, moderate, settings,
   attach a chat room) is a plain link or form post. What this file adds is only comfort. */
(function () {
  'use strict';
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // A silent sign-in that found no session leaves ?sso=none behind — tidy the address bar.
  if (/[?&]sso=none\b/.test(location.search) && history.replaceState) {
    var u = new URL(location.href); u.searchParams.delete('sso');
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  }

  // A dead avatar URL (an old Live avatar, Media offline) falls back to the letter badge.
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('avatar')) return;
    var name = (img.parentNode && img.parentNode.textContent || '?').trim();
    var span = document.createElement('span'); span.className = 'avatar avatar-letter'; span.setAttribute('aria-hidden', 'true'); span.textContent = (name[0] || '?').toUpperCase();
    img.replaceWith(span);
  }, true);

  // A post's permalink (#post-12) is a copy target: a click on the number copies the full URL
  // (the anchor still navigates if the clipboard is unavailable).
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#post-"]') : null;
    if (!a || !navigator.clipboard) return;
    navigator.clipboard.writeText(location.href.split('#')[0] + a.getAttribute('href')).then(function () {
      var old = a.textContent; a.textContent = 'Link copied';
      setTimeout(function () { a.textContent = old; }, 1200);
    }).catch(function () { /* the anchor still jumps to the post */ });
  });
})();
