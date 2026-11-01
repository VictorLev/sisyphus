// A rider's avatar: a rounded square in the background they bought (stone
// if none) with their emblem in pixels, or their initial if they have no
// emblem, inside the metal border they bought, if any. Returned as SVG
// markup for the header, the Leaderboard and the shop.

// A colour, or a gradient (top-left to bottom-right) with an optional
// starfield.
const BACKGROUNDS = {
  default: '#3a3632',
  'bg-charcoal': '#2e2c2a',
  'bg-sand': '#9a8566',
  'bg-bronze': '#8a6a3a',
  'bg-slate': '#4f6370',
  'bg-ember': '#a4513a',
  'bg-forest': '#4c6b3c',
  'bg-sky': '#4f86b0',
  'bg-teal': '#2f7a78',
  'bg-olive': '#6b6a3a',
  'bg-royal': '#5b4a7a',
  'bg-coral': '#c8695a',
  'bg-rose': '#a8506e',
  'bg-lavender': '#7d6fa8',
  'bg-midnight': '#1f2a44',
  'bg-crimson': '#8a2230',
  'bg-sunset': { stops: ['#f2a65a', '#c8463a', '#5b2a5a'] },
  'bg-ocean': { stops: ['#5fc4d9', '#2f6fa8', '#1f2a5a'] },
  'bg-aurora': { stops: ['#4fd9a0', '#2f7aa8', '#7a4fa8'] },
  'bg-gold': { stops: ['#fff1a8', '#e0b04a', '#8a6420'] },
  'bg-galaxy': { stops: ['#3a2a6a', '#14122a', '#000000'], stars: true },
};

// 8 × 8 emblems, light on the background unless they bring a colour.
const EMBLEMS = {
  'emblem-boulder': ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..'],
  'emblem-wheel': ['..XXXX..', '.X..X.X.', 'X...X..X', 'XXXXXXXX', 'X..X...X', 'X..X...X', '.X.X..X.', '..XXXX..'],
  'emblem-flame': ['...X....', '...XX...', '..XXX.X.', '..XXXXX.', '.XXX.XX.', '.XX...X.', '.XX..XX.', '..XXXX..'],
  'emblem-mountain': ['........', '....X...', '...XXX..', '..XX.XX.', '.XX...XX', 'XX.X...X', 'X...XX.X', 'XXXXXXXX'],
  'emblem-laurel': ['X......X', 'XX....XX', '.X....X.', 'XX....XX', '.XX..XX.', '..XXXX..', '...XX...', '..X..X..'],
  'emblem-crown': ['........', 'X..XX..X', 'XX.XX.XX', 'XXXXXXXX', 'XXXXXXXX', 'X.XXXX.X', 'XXXXXXXX', '........'],
  'emblem-heart': { rows: ['........', '.XX..XX.', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '...XX...', '........'], color: '#e8607a' },
  'emblem-star': ['...XX...', '...XX...', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '.XXXXXX.', '.XX..XX.', 'X......X'],
  'emblem-bolt': { rows: ['....XXX.', '...XXX..', '..XXX...', '.XXXXXX.', '...XXX..', '..XXX...', '.XXX....', 'XX......'], color: '#f2d27a' },
  'emblem-music': ['...XXXXX', '...X...X', '...X...X', '...X...X', '.XXX.XXX', 'XXXXXXXX', 'XXX..XXX', '........'],
  'emblem-coffee': ['..X.X...', '.X.X....', '........', 'XXXXXX..', 'XXXXXXXX', 'XXXXXX.X', 'XXXXXXX.', '.XXXX...'],
  'emblem-cat': ['X.....X.', 'XX...XX.', 'XXXXXXX.', 'X.XXX.X.', 'XXXXXXX.', 'XX.X.XX.', '.XXXXX..', '........'],
  'emblem-ghost': ['..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XX.XX.XX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XX.XX.XX'],
  'emblem-maple': { rows: ['...XX...', '.X.XX.X.', 'XXXXXXXX', '.XXXXXX.', 'XXXXXXXX', '..XXXX..', '...XX...', '...XX...'], color: '#e0503a' },
  'emblem-moon': ['..XXXX..', '.XXX....', 'XXX.....', 'XXX.....', 'XXX.....', 'XXX.....', '.XXX....', '..XXXX..'],
  'emblem-skull': ['.XXXXXX.', 'XXXXXXXX', 'X..XX..X', 'X..XX..X', 'XXXXXXXX', '.XXXXXX.', '.X.X.X.X', '........'],
  'emblem-bike': ['........', '...XX...', '....X...', '.XXXXX..', 'X.X..X.X', 'XXX..XXX', 'X.X..X.X', '.X....X.'],
  'emblem-rocket': ['...XX...', '..XXXX..', '..X..X..', '..XXXX..', '..XXXX..', '.XXXXXX.', 'X.XXXX.X', '..X..X..'],
  'emblem-trophy': { rows: ['XXXXXXXX', 'X.XXXX.X', 'X.XXXX.X', '.XXXXXX.', '..XXXX..', '...XX...', '..XXXX..', '.XXXXXX.'], color: '#f2c94c' },
  'emblem-gem': { rows: ['.XXXXXX.', 'X.X..X.X', 'XXXXXXXX', '.X....X.', '..X..X..', '...XX...', '........', '........'], color: '#9fe3f0' },
};

// Metal borders: a gradient around the square, light to dark (to light,
// for the polished ones); the precious ones sparkle at the corners.
const BORDERS = {
  'border-lead': { stops: ['#6b6f76', '#4a4e55'] },
  'border-tin': { stops: ['#c9ccd1', '#9aa0a8'] },
  'border-copper': { stops: ['#e08a5b', '#a4513a'] },
  'border-bronze': { stops: ['#c8964f', '#7a5a2b'] },
  'border-brass': { stops: ['#e8c46a', '#a8862f'] },
  'border-iron': { stops: ['#8a8f96', '#5b6068'] },
  'border-steel': { stops: ['#cdd3da', '#7d858f'] },
  'border-silver': { stops: ['#f2f4f6', '#a8aeb6'] },
  'border-gold': { stops: ['#fff1a8', '#d9a93a'] },
  'border-rosegold': { stops: ['#f6c9b4', '#c88a76'] },
  'border-whitegold': { stops: ['#fbf7ea', '#d8cfb4'] },
  'border-titanium': { stops: ['#b9bcc4', '#6f7480'] },
  'border-cobalt': { stops: ['#7fa6e6', '#2f4f9a'] },
  'border-chrome': { stops: ['#ffffff', '#8a94a3', '#ffffff'] },
  'border-palladium': { stops: ['#e6e8ec', '#b5bac2'] },
  'border-rhodium': { stops: ['#f7f9fc', '#c6ccd6', '#f7f9fc'] },
  'border-iridium': { stops: ['#d8e0e8', '#8f9cab', '#c4b5e0'], sparkle: true },
  'border-platinum': { stops: ['#ffffff', '#d5dae2', '#a9b2bf', '#ffffff'], sparkle: true },
  'border-mithril': { stops: ['#e8fbff', '#a9d8e8', '#e0e8ff'], sparkle: true },
  'border-diamond': { stops: ['#ffffff', '#bdf3ff', '#d9c8ff', '#ffffff'], sparkle: true, width: 1.3 },
};

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Gradient ids must be unique on the page: many avatars share it.
let nextId = 0;
const gradient = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${
  stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('')}</linearGradient>`;

export function avatarSvg({ bg = null, emblem = null, border = null, name = '' } = {}, { size = 32, title = '' } = {}) {
  const uid = `av${++nextId}`;
  const defs = [];
  const back = BACKGROUNDS[bg] ?? BACKGROUNDS.default;
  let fill = back;
  if (typeof back === 'object') {
    defs.push(gradient(`${uid}b`, back.stops));
    fill = `url(#${uid}b)`;
  }
  // A few fixed stars for the galaxy, under the emblem.
  const stars = back.stars
    ? '<g fill="#ffffff">' + [[2, 3], [9, 2], [5, 9], [10, 8], [3, 7], [7, 5]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="${i % 2 ? 0.5 : 0.7}" height="${i % 2 ? 0.5 : 0.7}" opacity="0.85"/>`).join('') + '</g>'
    : '';

  const art = EMBLEMS[emblem];
  const rows = Array.isArray(art) ? art : art?.rows;
  let inner;
  if (rows) {
    const cells = [];
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === 'X') cells.push(`<rect x="${2 + x}" y="${2 + y}" width="1" height="1"/>`);
    }));
    inner = `<g fill="${art.color ?? '#f3ead8'}">${cells.join('')}</g>`;
  } else {
    const initial = escapeXml((name.trim()[0] ?? '?').toUpperCase());
    inner = `<text x="6" y="9.2" text-anchor="middle" font-size="7.5" font-weight="700" font-family="system-ui, sans-serif" fill="#f3ead8">${initial}</text>`;
  }

  let frame = '';
  const metal = BORDERS[border];
  if (metal) {
    defs.push(gradient(`${uid}m`, metal.stops));
    const w = metal.width ?? 1;
    frame = `<rect x="${w / 2}" y="${w / 2}" width="${12 - w}" height="${12 - w}" rx="${2.5 - w / 2}" fill="none" stroke="url(#${uid}m)" stroke-width="${w}"/>`;
    if (metal.sparkle) {
      frame += '<g fill="#ffffff">' + [[1.1, 1.1], [10.2, 1.1], [1.1, 10.2], [10.2, 10.2]].map(([x, y]) => `<rect x="${x}" y="${y}" width="0.7" height="0.7"/>`).join('') + '</g>';
    }
  }

  const label = title ? `<title>${escapeXml(title)}</title>` : '';
  return `<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 12 12" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(title || name)}">${label}${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<rect width="12" height="12" rx="2.5" fill="${fill}"/>${stars}${inner}${frame}</svg>`;
}
