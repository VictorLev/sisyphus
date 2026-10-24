// A rider's avatar: a rounded square in the background they bought (stone
// if none) with their emblem in pixels, or their initial if they have no
// emblem. Returned as SVG markup for the header, the Leaderboard and the
// shop.

const BACKGROUNDS = {
  default: '#3a3632',
  'bg-bronze': '#8a6a3a',
  'bg-slate': '#4f6370',
  'bg-ember': '#a4513a',
  'bg-forest': '#4c6b3c',
  'bg-royal': '#5b4a7a',
};

// 8 × 8 emblems.
const EMBLEMS = {
  'emblem-boulder': ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..'],
  'emblem-wheel': ['..XXXX..', '.X..X.X.', 'X...X..X', 'XXXXXXXX', 'X..X...X', 'X..X...X', '.X.X..X.', '..XXXX..'],
  'emblem-flame': ['...X....', '...XX...', '..XXX.X.', '..XXXXX.', '.XXX.XX.', '.XX...X.', '.XX..XX.', '..XXXX..'],
  'emblem-mountain': ['........', '....X...', '...XXX..', '..XX.XX.', '.XX...XX', 'XX.X...X', 'X...XX.X', 'XXXXXXXX'],
  'emblem-laurel': ['X......X', 'XX....XX', '.X....X.', 'XX....XX', '.XX..XX.', '..XXXX..', '...XX...', '..X..X..'],
  'emblem-crown': ['........', 'X..XX..X', 'XX.XX.XX', 'XXXXXXXX', 'XXXXXXXX', 'X.XXXX.X', 'XXXXXXXX', '........'],
};

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function avatarSvg({ bg = null, emblem = null, name = '' } = {}, { size = 32, title = '' } = {}) {
  const fill = BACKGROUNDS[bg] ?? BACKGROUNDS.default;
  const rows = EMBLEMS[emblem];
  let inner;
  if (rows) {
    const cells = [];
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === 'X') cells.push(`<rect x="${2 + x}" y="${2 + y}" width="1" height="1"/>`);
    }));
    inner = `<g fill="#f3ead8">${cells.join('')}</g>`;
  } else {
    const initial = escapeXml((name.trim()[0] ?? '?').toUpperCase());
    inner = `<text x="6" y="9.2" text-anchor="middle" font-size="7.5" font-weight="700" font-family="system-ui, sans-serif" fill="#f3ead8">${initial}</text>`;
  }
  const label = title ? `<title>${escapeXml(title)}</title>` : '';
  return `<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 12 12" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(title || name)}">${label}<rect width="12" height="12" rx="2.5" fill="${fill}"/>${inner}</svg>`;
}
