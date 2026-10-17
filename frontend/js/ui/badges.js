import { getBadges } from '../api/client.js';

// Badges: the Feats page lists them all by group; the ride summary and a
// ride's Chronicle page show the ones that ride earned. Computed by the
// server from the log (backend/src/badges.js); secrets arrive as "???".

// A short glyph per group, drawn on the badge's medallion in the pixel font
// (plain ASCII: the font has no symbols such as ★ or ✓).
const GLYPHS = {
  Pushes: 'P', Distance: 'KM', Time: 'H', 'Big Rides': 'XL', Consistency: '7',
  Power: 'W', FTP: '%', Workouts: 'WO', Oddities: '?!', Secrets: '?',
};

const dateText = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function progressText({ value, target, unit }) {
  return `${value.toLocaleString()} / ${target.toLocaleString()}${unit ? ` ${unit}` : ''}`;
}

export function badgeTile(badge, { onOpenRide } = {}) {
  const tile = document.createElement('li');
  tile.className = `badge-tile tier-${badge.tier}${badge.earned ? ' is-earned' : ' is-locked'}`;

  const medal = document.createElement('span');
  medal.className = 'badge-medal';
  medal.setAttribute('aria-hidden', 'true');
  medal.textContent = badge.earned || !badge.hidden ? GLYPHS[badge.group] ?? '•' : '?';

  const body = document.createElement('div');
  body.className = 'badge-body';
  const name = document.createElement('strong');
  name.className = 'badge-name';
  name.textContent = badge.name;
  const desc = document.createElement('span');
  desc.className = 'badge-desc';
  desc.textContent = badge.description;
  body.append(name, desc);

  if (badge.earned) {
    const when = document.createElement('span');
    when.className = 'badge-when';
    when.textContent = `Earned ${dateText(badge.earned_at)}`;
    body.append(when);
    if (badge.session_id && onOpenRide) {
      tile.classList.add('is-clickable');
      tile.tabIndex = 0;
      tile.title = 'Open the ride that earned it';
      const open = () => onOpenRide(badge.session_id);
      tile.addEventListener('click', open);
      tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    }
  } else if (badge.progress && badge.progress.target > 0) {
    const meter = document.createElement('span');
    meter.className = 'badge-progress';
    const fill = document.createElement('span');
    fill.style.width = `${Math.min(100, (badge.progress.value / badge.progress.target) * 100)}%`;
    meter.append(fill);
    const text = document.createElement('span');
    text.className = 'badge-when';
    text.textContent = progressText(badge.progress);
    body.append(meter, text);
  } else if (badge.hidden) {
    const text = document.createElement('span');
    text.className = 'badge-when';
    text.textContent = 'Secret';
    body.append(text);
  }

  tile.append(medal, body);
  return tile;
}

// Feats → Badges.
export function initBadges({ onOpenRide }) {
  const summaryEl = document.getElementById('badges-summary');
  const groupsEl = document.getElementById('badges-groups');

  async function refresh() {
    let data;
    try {
      data = await getBadges();
    } catch (err) {
      summaryEl.textContent = `Could not load badges: ${err.message}`;
      return;
    }
    summaryEl.textContent = `${data.earned} of ${data.total} earned`;
    groupsEl.innerHTML = '';
    const groups = new Map();
    for (const badge of data.badges) {
      if (!groups.has(badge.group)) groups.set(badge.group, []);
      groups.get(badge.group).push(badge);
    }
    for (const [group, badges] of groups) {
      const section = document.createElement('section');
      section.className = 'badge-group';
      const heading = document.createElement('h3');
      const earned = badges.filter((b) => b.earned).length;
      heading.textContent = `${group} · ${earned}/${badges.length}`;
      const list = document.createElement('ul');
      list.className = 'badge-grid';
      for (const badge of badges) list.append(badgeTile(badge, { onOpenRide }));
      section.append(heading, list);
      groupsEl.append(section);
    }
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'feats') refresh();
  });
  return { refresh };
}

// The badges one ride earned, into `container` (hidden when there are none).
export async function showRideBadges(container, sessionId, { title, onOpenRide } = {}) {
  container.hidden = true;
  let data;
  try {
    data = await getBadges();
  } catch {
    return;
  }
  const earned = data.badges.filter((b) => b.earned && b.session_id === sessionId);
  if (earned.length === 0) return;
  container.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = title ?? (earned.length === 1 ? 'New badge' : `${earned.length} new badges`);
  const list = document.createElement('ul');
  list.className = 'badge-grid';
  for (const badge of earned) list.append(badgeTile(badge, { onOpenRide }));
  container.append(heading, list);
  container.hidden = false;
}
