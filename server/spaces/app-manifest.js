'use strict';
/**
 * A published space installs as an app (plan §AD.15: "a space as an app: install it on a phone (PWA)"). Each published
 * space serves, beside its files and never as one of them:
 *
 *   /_openvibe/manifest.webmanifest   its name, its home, standalone, its colour
 *   /_openvibe/icon.svg               a rounded tile in the space's own hue with its first letter
 *   /_openvibe/icon-192.png, -512.png the same, drawn (an install needs PNGs of these sizes)
 *
 * and the space SDK (/_openvibe/sdk.js) adds the manifest link to a page that has none, so a space made from any
 * template can be added to a home screen. A space that ships its own manifest.webmanifest and links it keeps its own.
 */
const SIZES = [192, 512];
const cache = new Map();   // `${id}|${name}|${size}` → PNG buffer

/** A hue from the space's id, so each space keeps its colour. */
function hueOf(id) {
    let h = 0;
    for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
}
const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
/** The space's first letter (or digit), upper case; a space named with neither gets a dot. */
function initialOf(name) {
    const m = String(name || '').match(/[\p{L}\p{N}]/u);
    return m ? m[0].toLocaleUpperCase() : '•';
}

function iconSvg(space) {
    const h = hueOf(space.id);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`
        + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},78%,58%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},72%,40%)"/></linearGradient></defs>`
        + `<rect width="512" height="512" rx="112" fill="url(#g)"/>`
        + `<circle cx="412" cy="100" r="34" fill="#fff" fill-opacity=".22"/>`
        + `<text x="256" y="256" dy=".36em" text-anchor="middle" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-size="268" font-weight="800" fill="#fff">${xmlEsc(initialOf(space.name))}</text></svg>`;
}

function iconPng(space, size) {
    if (!SIZES.includes(size)) return null;
    const key = `${space.id}|${space.name}|${size}`;
    if (cache.has(key)) return cache.get(key);
    const { Resvg } = require('@resvg/resvg-js');
    const png = Buffer.from(new Resvg(iconSvg(space), { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: true } }).render().asPng());
    if (cache.size > 400) cache.clear();
    cache.set(key, png);
    return png;
}

function manifest(space) {
    const h = hueOf(space.id);
    const name = String(space.name || space.slug || 'Space').slice(0, 45);
    return {
        name,
        short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
        description: String(space.description || '').slice(0, 200) || undefined,
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: `hsl(${h}, 30%, 10%)`,
        theme_color: `hsl(${h}, 60%, 30%)`,
        icons: [
            ...SIZES.map((s) => ({ src: `/_openvibe/icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })),
            { src: '/_openvibe/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
    };
}

/** Answer one of the app's own paths for a published space, or return false. */
function serve(space, rawPath, req, res) {
    const head = req.method === 'HEAD';
    const send = (type, body, cache = 'public, max-age=3600') => {
        res.statusCode = 200;
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', cache);
        res.end(head ? undefined : body);
        return true;
    };
    if (rawPath === '/_openvibe/manifest.webmanifest') return send('application/manifest+json; charset=utf-8', JSON.stringify(manifest(space)), 'public, max-age=300');
    if (rawPath === '/_openvibe/icon.svg') return send('image/svg+xml; charset=utf-8', iconSvg(space));
    const m = /^\/_openvibe\/icon-(\d{3})\.png$/.exec(rawPath);
    if (m) {
        const png = iconPng(space, Number(m[1]));
        if (png) return send('image/png', png);
    }
    return false;
}

module.exports = { manifest, iconSvg, iconPng, serve, hueOf, initialOf, SIZES };
