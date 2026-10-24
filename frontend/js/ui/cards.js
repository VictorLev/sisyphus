// Card pieces shared by the Workouts and Routes pages and the Home pickers:
// a workout's power graph, a route's elevation profile, and the star.

import { ZONES } from '../zones.js';
import { t } from '../i18n.js';

const ASSUMED_FTP = 200; // only for old segments in watts, to place them on the % scale

// Each segment as a bar: as wide as it is long, as tall as its % of FTP,
// coloured by its power zone. Ramps (start/end % differing) slope.
export function workoutGraphSvg(structure) {
  const w = 300;
  const h = 64;
  const pct = (seg, key = 'target_ftp_pct') => seg[key] ?? (seg.target_watts != null ? (seg.target_watts / ASSUMED_FTP) * 100 : 50);
  const total = structure.reduce((s, seg) => s + seg.duration_sec, 0) || 1;
  const top = Math.max(120, ...structure.map((seg) => pct(seg)));
  const y = (p) => (h - Math.max(2, (p / top) * (h - 2))).toFixed(1);
  let x = 0;
  const bars = structure.map((seg) => {
    const width = (seg.duration_sec / total) * w;
    const p = pct(seg);
    const zone = ZONES.find((z) => p / 100 < z.max) ?? ZONES[ZONES.length - 1];
    const x0 = x.toFixed(1);
    const x1 = (x + Math.max(0.5, width - 0.6)).toFixed(1);
    x += width;
    return `<polygon points="${x0},${h} ${x0},${y(p)} ${x1},${y(p)} ${x1},${h}" fill="${zone.color}" />`;
  });
  return `<svg class="card-graph" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${bars.join('')}</svg>`;
}

// The route's elevation preview as a filled line.
export function routeProfileSvg(altitudes) {
  const w = 300;
  const h = 64;
  const min = Math.min(...altitudes);
  const range = Math.max(10, Math.max(...altitudes) - min); // flat roads stay flat-looking
  const pts = altitudes.map((a, i) => `${((i / (altitudes.length - 1)) * w).toFixed(1)},${(h - 2 - ((a - min) / range) * (h - 8)).toFixed(1)}`);
  return `<svg class="card-graph route-profile" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,${h} ${pts.join(' ')} ${w},${h}" /><polyline points="${pts.join(' ')}" /></svg>`;
}

// The ☆/★ toggle in a card's corner.
export function starButton(starred, onToggle) {
  const star = document.createElement('button');
  star.type = 'button';
  star.className = `star-btn card-star${starred ? ' is-starred' : ''}`;
  star.textContent = starred ? '★' : '☆';
  star.title = t(starred ? 'workouts.unstar' : 'workouts.star');
  star.setAttribute('aria-label', star.title);
  star.setAttribute('aria-pressed', String(Boolean(starred)));
  star.addEventListener('click', (event) => {
    event.stopPropagation();
    onToggle();
  });
  return star;
}

// A card: graph on top, title and details, then the actions. Returns the
// <li> and its actions box to fill.
// `image` (a URL) puts a picture on top, with the graph as a strip under it.
export function card({ graph, image, title, meta, tag, starred, onToggleStar }) {
  const li = document.createElement('li');
  li.className = 'card';
  if (image) {
    const img = document.createElement('img');
    img.className = 'card-image';
    img.src = image;
    img.alt = '';
    img.loading = 'lazy';
    li.append(img);
    li.classList.add('has-image');
  }
  li.insertAdjacentHTML('beforeend', graph);
  if (onToggleStar) li.append(starButton(starred, onToggleStar));
  const body = document.createElement('div');
  body.className = 'card-body';
  const name = document.createElement('span');
  name.className = 'card-title';
  name.textContent = title;
  body.append(name);
  if (tag) {
    const tagEl = document.createElement('span');
    tagEl.className = 'workout-tag';
    tagEl.textContent = tag;
    body.append(tagEl);
  }
  const metaEl = document.createElement('span');
  metaEl.className = 'card-meta';
  metaEl.textContent = meta;
  body.append(metaEl);
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  li.append(body, actions);
  return { li, actions };
}

// Card actions as icons, in the menu's line style. The name stays as the
// tooltip and for screen readers.
const ICONS = {
  start: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  edit: '<path d="M4 20h4L19.5 8.5l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  delete: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/>',
  export: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  copy: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  picture: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
};

export function iconButton(icon, label, onClick, { primary = false } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'icon-btn is-primary' : 'icon-btn secondary';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
  b.addEventListener('click', onClick);
  return b;
}
