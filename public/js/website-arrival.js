/* The Website front door has no cookies or account actions. A Network account continues on Space. */
(function () {
    'use strict';
    if (window.top !== window) return;
    try { if (localStorage.getItem('ov_sso_hint') === 'guest') return; } catch { /* no stored hint */ }
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none';
    const finish = (signedIn) => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        frame.remove();
        if (signedIn) location.replace('https://openvibe.space/spaces/mine');
    };
    const onMessage = (event) => {
        if (event.origin !== 'https://openvibe.network' || event.source !== frame.contentWindow || event.data?.type !== 'ov-sso') return;
        finish(event.data.signedIn === true);
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => finish(false), 4000);
    frame.src = `https://openvibe.network/sso/check?origin=${encodeURIComponent(location.origin)}`;
    document.body.appendChild(frame);
})();
