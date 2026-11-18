'use strict';
/**
 * Space's own app icon: the network's app icon look (the OpenVibe mark on the dark tile) with the corner from the
 * shared corner scale (plan AB.29).
 *
 *   node scripts/build-icons.js          write public/assets/logo.svg and the PNGs
 *
 * The tile's corner is "round": 22.5 % of the side, the number OpenVibe.Design's glyph export uses
 * (server/glyphs/rounding.js there), so the menu's app icons, a site's mark and the generator agree. The mark is
 * openvibe-shared's Pair in its heavy form — the one the app icons use — drawn a little fuller in the tile than
 * before, so it reads at 16 px as well as at 180.
 *
 *   logo.svg                  the tile, 64 units (the favicon and the any-purpose icon)
 *   logo-72/192/512.png       the same tile, at each size
 *   logo-maskable-192/512.png the full-bleed form: the platform masks it, so the mark keeps to the safe zone
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const MARK = require('openvibe-shared/mark');

// The corner scale (plan AB.29): a share of the tile's side. The same numbers as OpenVibe.Design's glyph export
// (server/glyphs/rounding.js); the squircle is drawn there, and an app icon's own corner is the round one.
const ROUNDING = Object.freeze({ none: 0, soft: 0.12, round: 0.225 });
const ROUNDING_NAME = 'round';

// Space's own colours: the mark's two tones (the network's violet-blue) on the network's dark tile.
const ACCENT = ['#818cf8', '#4f46e5'];
const BG = ['#16223a', '#0a0f1c', '#060912'];

const OUT = path.join(__dirname, '..', 'public', 'assets');
// The tile is 64 units; the mark is drawn in openvibe-shared's own 100-unit box, so it is scaled into it. The heavy
// form's ink is 93.8 units wide, so 0.62 leaves the mark filling the tile without touching its edge.
const TILE = 64;
const MARK_SCALE = 0.62;
// The full-bleed form: the platform's mask may cut a corner off, so the mark keeps to the safe zone (a circle of
// 40 % of the width, as the app icons do).
const BLEED = 512;
const BLEED_SCALE = 4.2;

const defs = (form) => `<defs>${MARK.art({ form, id: 'ov', depth: true }).defs}
<radialGradient id="glow"><stop offset="0" stop-color="${ACCENT[0]}" stop-opacity=".3"/><stop offset="1" stop-color="${ACCENT[0]}" stop-opacity="0"/></radialGradient>
<radialGradient id="bg" cx=".5" cy=".38" r=".8"><stop offset="0" stop-color="${BG[0]}"/><stop offset=".6" stop-color="${BG[1]}"/><stop offset="1" stop-color="${BG[2]}"/></radialGradient></defs>`;
const mark = (scale, form) => {
    const { body } = MARK.art({ form, id: 'ov', depth: true });
    return `<g transform="scale(${scale}) translate(-50 -50)"><ellipse cx="50" cy="50" rx="52" ry="40" fill="url(#glow)"/>${body}</g>`;
};
/** The tile: the ground, the corner the scale asks for, and the mark on it. */
const tile = () => {
    const half = TILE / 2;
    const rx = +(TILE * ROUNDING[ROUNDING_NAME]).toFixed(3);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${TILE} ${TILE}">${defs('heavy')}<rect x="${-half}" y="${-half}" width="${TILE}" height="${TILE}" rx="${rx}" fill="url(#bg)"/>${mark(MARK_SCALE, 'heavy')}</svg>`;
};
/** The full-bleed form: no corner (the platform cuts it) and the mark inside the safe zone. */
const bleed = () => {
    const half = BLEED / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${BLEED} ${BLEED}">${defs('heavy')}<rect x="${-half}" y="${-half}" width="${BLEED}" height="${BLEED}" fill="url(#bg)"/>${mark(BLEED_SCALE, 'heavy')}</svg>`;
};
const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();

/** Write every file: the SVG, the three sizes of the tile, and the two maskable ones. */
function build() {
    fs.mkdirSync(OUT, { recursive: true });
    const tileSvg = tile();
    fs.writeFileSync(path.join(OUT, 'logo.svg'), tileSvg);
    for (const size of [72, 192, 512]) fs.writeFileSync(path.join(OUT, `logo-${size}.png`), png(tileSvg, size));
    const bleedSvg = bleed();
    for (const size of [192, 512]) fs.writeFileSync(path.join(OUT, `logo-maskable-${size}.png`), png(bleedSvg, size));
    return tileSvg;
}

if (require.main === module) {
    build();
    console.log('wrote Space\'s app icon: logo.svg, logo-72/192/512.png, logo-maskable-192/512.png');
}

module.exports = { build, tile, bleed, ROUNDING, ROUNDING_NAME, MARK_SCALE };
