// What Sisyphus wears: the hat and boulder bought in the shop, drawn into
// the pixel art of the ride screen (ui/ride-hero.js) and the header loop
// (ui/sisyphus-loop.js). Both draw with a px(x, y, color) of their own, so
// the hats and skins here are sizes-free: hats sit on whatever head is
// given, and boulder skins colour any boulder mask.

let equipped = { hat: null, boulder: null };

export function setEquipped(next) {
  equipped = { hat: next?.hat ?? null, boulder: next?.boulder ?? null };
  document.dispatchEvent(new CustomEvent('cosmeticschange', { detail: equipped }));
}

export const getEquipped = () => equipped;

// Hats: letters are colours, '.' is empty. Drawn centred on the head, with
// their last row on the row above it.
const HATS = {
  'hat-party': { rows: ['..P..', '.PY..', '.YPP.', 'PPYPY'], colors: { P: '#d77a9e', Y: '#f2d27a' } },
  'hat-laurel': { rows: ['G...G', 'GG.GG'], colors: { G: '#6f9a4f' } },
  'hat-helmet': { rows: ['.RRR.', 'RWRWR', 'RRRRR'], colors: { R: '#c8463a', W: '#f0e6dc' } },
  'hat-crown': { rows: ['Y.Y.Y', 'YRYRY', 'YYYYY'], colors: { Y: '#f2c94c', R: '#c8463a' } },
};

export function drawHat(px, headLeft, headWidth, headTop, hatId = equipped.hat) {
  const hat = HATS[hatId];
  if (!hat) return;
  const w = hat.rows[0].length;
  const left = headLeft + Math.floor((headWidth - w) / 2);
  const top = headTop - hat.rows.length;
  hat.rows.forEach((row, ry) => {
    [...row].forEach((c, rx) => {
      const color = hat.colors[c];
      if (color && top + ry >= 0) px(left + rx, top + ry, color);
    });
  });
}

// Boulder skins: a colour for each pixel of the boulder's mask, from its
// position (x, y) in a w × h box; null leaves it empty (the donut's hole).
const SKINS = {
  'boulder-gold': (x, y, w, h) => (x + y < (w + h) / 3 ? '#f6e3b4' : x + y > (w + h) * 0.75 ? '#b08d57' : '#e0c088'),
  'boulder-earth': (x, y) => ((x * 3 + y * 5) % 7 < 3 ? '#5f8a4a' : '#3f6f9a'),
  'boulder-donut': (x, y, w, h) => {
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    if (Math.abs(x - cx) < 1 && Math.abs(y - cy) < 1) return null; // the hole
    if (y < cy) return (x * 7 + y * 3) % 5 === 0 ? '#f2d27a' : '#d77a9e'; // icing and sprinkles
    return '#c99a5b';
  },
  'boulder-disco': (x, y) => ((x + y) % 4 === 0 ? '#ffffff' : (x + y) % 2 ? '#9a9fa8' : '#d7dbe2'),
};

// Draws a boulder mask ('X' rows) at ox, oy: in its skin, or `color`.
export function drawBoulder(px, sprite, ox, oy, color, skinId = equipped.boulder) {
  const skin = SKINS[skinId];
  const h = sprite.length;
  const w = sprite[0].length;
  sprite.forEach((row, ry) => {
    [...row].forEach((cell, rx) => {
      if (cell !== 'X') return;
      const c = skin ? skin(rx, ry, w, h) : color;
      if (c) px(ox + rx, oy + ry, c);
    });
  });
}
