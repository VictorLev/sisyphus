import { getBadges } from '../api/client.js';
import { t, tp, num, date } from '../i18n.js';

// Badges: the Feats page lists them all by group; the ride summary and a
// ride's Chronicle page show the ones that ride earned. Computed by the
// server from the log (backend/src/badges.js); secrets arrive as "???".

// A short glyph per group, drawn on the badge's medallion in the pixel font
// (plain ASCII: the font has no symbols such as ★ or ✓).
const GLYPHS = {
  Pushes: 'P', Distance: 'KM', Time: 'H', 'Big Rides': 'XL', Consistency: '7',
  Power: 'W', FTP: '%', Workouts: 'WO', Routes: 'RT', Workplace: '$', Champions: '#1', Oddities: '?!', Secrets: '?',
};

const dateText = (iso) =>
  date(iso, { year: 'numeric', month: 'short', day: 'numeric' });

function progressText({ value, target, unit }) {
  return `${num(value)} / ${num(target)}${unit ? ` ${t(`badgeUnit.${unit}`)}` : ''}`;
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
  // Names and descriptions come from the dictionaries by badge id; the
  // server's English is the fallback. A secret not yet earned shows its hint.
  const secret = badge.hidden && !badge.earned;
  name.textContent = secret ? '???' : t(`badge.${badge.id}.name`);
  const desc = document.createElement('span');
  desc.className = 'badge-desc';
  desc.textContent = t(`badge.${badge.id}.${secret ? 'hint' : 'desc'}`);
  body.append(name, desc);

  if (badge.earned) {
    const when = document.createElement('span');
    when.className = 'badge-when';
    when.textContent = t('badges.earnedOn', { date: dateText(badge.earned_at) });
    body.append(when);
    if (badge.session_id && onOpenRide) {
      tile.classList.add('is-clickable');
      tile.tabIndex = 0;
      tile.title = t('badges.openRide');
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
    text.textContent = t('badges.secret');
    body.append(text);
  }

  tile.append(medal, body);
  return tile;
}

// The earned count beside the level in the nav; pressing it opens Badges.
function setNavCount(earned) {
  const button = document.getElementById('nav-badges');
  document.getElementById('nav-badges-count').textContent = String(earned);
  button.title = tp('badges.earnedCount', earned);
  button.setAttribute('aria-label', button.title);
  button.hidden = false;
}

export async function refreshBadgeCount() {
  try {
    setNavCount((await getBadges()).earned);
  } catch { /* the count is a nicety; the Badges tab says what went wrong */ }
}

// The Badges tab.
export function initBadges({ onOpenRide, onOpenBadges }) {
  document.getElementById('nav-badges').addEventListener('click', () => onOpenBadges());

  const summaryEl = document.getElementById('badges-summary');
  const groupsEl = document.getElementById('badges-groups');

  async function refresh() {
    let data;
    try {
      data = await getBadges();
    } catch (err) {
      summaryEl.textContent = t('badges.loadFailed', { error: err.message });
      return;
    }
    summaryEl.textContent = t('badges.summary', { earned: data.earned, total: data.total });
    setNavCount(data.earned);
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
      heading.textContent = `${t(`badgeGroup.${group}`)} · ${earned}/${badges.length}`;
      const list = document.createElement('ul');
      list.className = 'badge-grid';
      for (const badge of badges) list.append(badgeTile(badge, { onOpenRide }));
      section.append(heading, list);
      groupsEl.append(section);
    }
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'badges') refresh();
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
  heading.textContent = title ?? tp('badges.new', earned.length);
  const list = document.createElement('ul');
  list.className = 'badge-grid';
  for (const badge of earned) list.append(badgeTile(badge, { onOpenRide }));
  container.append(heading, list);
  container.hidden = false;
}
