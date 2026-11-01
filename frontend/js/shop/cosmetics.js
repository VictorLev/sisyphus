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
  'hat-beanie': { rows: ['..W..', '.BBB.', 'BBBBB', 'WWWWW'], colors: { B: '#c8463a', W: '#f0e6dc' } },
  'hat-cap': { rows: ['.BBB..', 'BBBBBB'], colors: { B: '#3f6f9a' } },
  'hat-bunny': { rows: ['W...W', 'P...P', 'W...W'], colors: { W: '#f0e6dc', P: '#e8a0b8' } },
  'hat-chef': { rows: ['.WWW.', 'WWWWW', '.WWW.', '.GGG.'], colors: { W: '#ffffff', G: '#d7dbe2' } },
  'hat-cowboy': { rows: ['..BB..', '.BRRB.', 'BBBBBB'], colors: { B: '#8a5a2b', R: '#c8463a' } },
  'hat-santa': { rows: ['....W', '..RR.', '.RRR.', 'WWWWW'], colors: { R: '#c8463a', W: '#f0e6dc' } },
  'hat-tophat': { rows: ['.KKK.', '.KKK.', '.RRR.', 'KKKKK'], colors: { K: '#3a3430', R: '#c8463a' } },
  'hat-pirate': { rows: ['.KKK.', 'KKWKK', 'KKKKK'], colors: { K: '#3a3430', W: '#f0e6dc' } },
  'hat-propeller': { rows: ['RR.BB', '..K..', '.YBY.', 'YBYBY'], colors: { R: '#c8463a', B: '#3f6f9a', Y: '#f2d27a', K: '#3a3430' } },
  'hat-sombrero': { rows: ['...YY...', '..YRRY..', 'YYYYYYYY'], colors: { Y: '#d9b45a', R: '#c8463a' } },
  'hat-viking': { rows: ['H...H', 'HGGGH', 'GSGSG'], colors: { H: '#f0e6dc', G: '#9a9fa8', S: '#6b6f76' } },
  'hat-graduation': { rows: ['KKKKKKK', '..KKK.Y', '..KKK.Y'], colors: { K: '#3a3430', Y: '#f2c94c' } },
  'hat-wizard': { rows: ['...B.', '..BY.', '.BBB.', 'BYBBB', 'BBBBB'], colors: { B: '#3f4f9a', Y: '#f2d27a' } },
  // The halo floats: its last row is empty.
  'hat-halo': { rows: ['.YYY.', 'Y...Y', '.YYY.', '.....'], colors: { Y: '#f6e3b4' } },
  'hat-horns': { rows: ['R...R', 'RR.RR'], colors: { R: '#c8463a' } },
  'hat-tiara': { rows: ['..C..', '.WCW.', 'WWWWW'], colors: { C: '#7fd3e6', W: '#d7dbe2' } },
  'hat-astronaut': { rows: ['.WWW.', 'WCCCW', 'WWWWW'], colors: { W: '#f0e6dc', C: '#3f6f9a' } },
  'hat-hermes': { rows: ['W.....W', 'WW.Y.WW', '.WYYYW.', '..YYY..'], colors: { W: '#ffffff', Y: '#f2c94c' } },
  'hat-olympian': { rows: ['Y.....Y', 'YY...YY', '.YYYYY.'], colors: { Y: '#f2c94c' } },
  'hat-zeus': { rows: ['Y..L..Y', 'YY.L.YY', 'YYYLYYY', 'YRYYYRY'], colors: { Y: '#f2c94c', L: '#cfe8ff', R: '#c8463a' } },
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
  'boulder-basketball': (x, y, w, h) => (x === Math.floor(w / 2) || y === Math.floor(h / 2) ? '#2a1d14' : '#d9772b'),
  'boulder-soccer': (x, y) => (x % 3 === 1 && y % 3 === 1 ? '#1c1c1c' : '#f0f0f0'),
  'boulder-beachball': (x, y, w, h) => ['#c8463a', '#f2d27a', '#3f6f9a', '#f0f0f0'][Math.floor(((Math.atan2(y - (h - 1) / 2, x - (w - 1) / 2) + Math.PI) / (2 * Math.PI)) * 4) % 4],
  'boulder-watermelon': (x) => (x % 2 ? '#3f7a3a' : '#7fb35a'),
  'boulder-cookie': (x, y) => ((x * 5 + y * 3) % 7 === 0 ? '#4a2e1a' : '#c99a5b'),
  'boulder-cheese': (x, y) => ((x * 3 + y * 7) % 9 === 0 ? '#d9a93a' : '#f2c94c'),
  'boulder-pizza': (x, y, w, h) => {
    const r = Math.hypot(x - (w - 1) / 2, y - (h - 1) / 2);
    if (r > Math.min(w, h) / 2 - 1.2) return '#c99a5b'; // the crust
    if ((x * 7 + y * 5) % 11 === 0) return '#a4313a'; // pepperoni
    return (x + y) % 3 === 0 ? '#f2d27a' : '#d9542b';
  },
  'boulder-snowball': (x, y, w, h) => (x + y > (w + h) * 0.65 ? '#cfe0f0' : '#f4f8ff'),
  'boulder-eightball': (x, y, w, h) => (Math.abs(x - (w - 1) / 2) < 1.2 && Math.abs(y - h / 3) < 1.2 ? '#ffffff' : '#1c1c1c'),
  'boulder-moon': (x, y) => ((x * 4 + y * 3) % 7 === 0 || (x * 2 + y * 5) % 9 === 0 ? '#9a9a92' : '#c8c8c0'),
  'boulder-lava': (x, y) => ((x + y * 2) % 5 === 0 || (x * 2 - y + 20) % 7 === 0 ? '#e0602b' : '#2b1d1a'),
  'boulder-sun': (x, y, w, h) => {
    const r = Math.hypot(x - (w - 1) / 2, y - (h - 1) / 2) / (Math.min(w, h) / 2);
    return r < 0.35 ? '#fff2a8' : r < 0.75 ? '#f2c94c' : '#e08a2b';
  },
  'boulder-rainbow': (x, y, w, h) => ['#c8463a', '#e08a2b', '#f2c94c', '#6f9a4f', '#3f6f9a', '#7a5a9a'][Math.min(5, Math.floor((y / h) * 6))],
  'boulder-marble': (x, y) => ((x * 2 + y) % 6 === 0 || (x + y * 3) % 11 === 0 ? '#a8a49c' : '#f2f0ea'),
  'boulder-platinum': (x, y, w, h) => (x + y < (w + h) / 3 ? '#ffffff' : x + y > (w + h) * 0.75 ? '#9aa1ab' : '#d5dae2'),
  // Sisyphus's own: weathered stone, a little moss on top.
  'boulder-original': (x, y, w, h) => {
    if (y < h / 3 && (x * 3 + y) % 4 === 0) return '#5f7a46';
    if ((x * 5 + y * 7) % 13 === 0) return '#5b5751';
    return (x + y) % 3 ? '#8f8a82' : '#7a7670';
  },
  'boulder-diamond': (x, y) => {
    if ((x * 3 + y * 5) % 11 === 0) return '#ffffff'; // a glint
    return ['#e6fbff', '#9fe3f0', '#66c2d9', '#bdf3ff'][(x + 2 * y) % 4];
  },
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
