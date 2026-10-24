import { getLeaderboard } from '../api/client.js';
import { t, tp, num, locale } from '../i18n.js';
import { avatarSvg } from '../shop/avatar.js';

// Home → Leaderboard: every rider's totals for this week, month or year,
// ranked by time (the default: fair whatever anyone's FTP), distance or
// rides. Everyone is listed, a quiet week included, and your own row says
// "you" in words, not only in colour.

const METRICS = {
  minutes: {
    format: (r) => (r.minutes < 60 ? `${r.minutes} min` : `${Math.floor(r.minutes / 60)} h ${String(r.minutes % 60).padStart(2, '0')}`),
  },
  distance_km: { format: (r) => `${num(r.distance_km, 1)} km` },
  rides: { format: (r) => tp('unit.rides', r.rides) },
};

const STORAGE = 'sisyphus.leaderboard';

function readChoice() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    return {
      period: ['month', 'year'].includes(saved.period) ? saved.period : 'week',
      metric: saved.metric in METRICS ? saved.metric : 'minutes',
    };
  } catch {
    return { period: 'week', metric: 'minutes' };
  }
}

function rangeText(board) {
  const from = new Date(board.from);
  const last = new Date(Date.parse(board.to) - 1);
  // Named from the middle of the range: its edges use today's UTC offset, so
  // across a daylight-saving change the start reads as the day before.
  const middle = new Date((from.getTime() + last.getTime()) / 2);
  if (board.period === 'year') return String(middle.getFullYear());
  if (board.period === 'month') return middle.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  const day = { weekday: 'short', day: 'numeric', month: 'short' };
  return `${from.toLocaleDateString(locale(), day)} – ${last.toLocaleDateString(locale(), day)}`;
}

export function initLeaderboard() {
  const listEl = document.getElementById('leaderboard-list');
  const rangeEl = document.getElementById('leaderboard-range');
  const periodGroup = document.getElementById('leaderboard-period');
  const metricGroup = document.getElementById('leaderboard-metric');
  let choice = readChoice();
  let board = null;

  function markPressed() {
    for (const [group, value] of [[periodGroup, choice.period], [metricGroup, choice.metric]]) {
      for (const btn of group.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.value === value));
    }
  }

  function render() {
    listEl.innerHTML = '';
    if (!board) return;
    rangeEl.textContent = rangeText(board);
    const key = choice.metric;
    const riders = [...board.riders].sort((a, b) => b[key] - a[key] || b.minutes - a.minutes || a.name.localeCompare(b.name));
    const top = Math.max(1e-9, ...riders.map((r) => r[key]));
    if (riders.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t('lb.empty');
      listEl.appendChild(empty);
      return;
    }

    let rank = 0;
    riders.forEach((rider, i) => {
      // Ties share a rank (1, 1, 3); nobody ranks on zero.
      if (i === 0 || rider[key] !== riders[i - 1][key]) rank = i + 1;
      const li = document.createElement('li');
      li.className = `leaderboard-row${rider.you ? ' is-you' : ''}${rider[key] > 0 ? '' : ' is-idle'}`;
      const summary = `${rider.name}: ${METRICS.rides.format(rider)}, ${METRICS.minutes.format(rider)}, ${METRICS.distance_km.format(rider)}`;
      li.title = summary;
      li.setAttribute('aria-label', `${rider[key] > 0 ? `${t('lb.rank', { n: rank })}, ` : ''}${summary}${rider.you ? ` (${t('lb.you')})` : ''}`);

      const rankEl = document.createElement('span');
      rankEl.className = 'leaderboard-rank';
      rankEl.textContent = rider[key] > 0 ? String(rank) : '–';

      const who = document.createElement('span');
      who.className = 'leaderboard-who';
      who.insertAdjacentHTML('beforeend', avatarSvg({ ...rider.avatar, name: rider.name }, { size: 22 }));
      const name = document.createElement('span');
      name.className = 'leaderboard-name';
      name.textContent = rider.name;
      who.append(name);
      if (rider.you) {
        const you = document.createElement('span');
        you.className = 'leaderboard-you';
        you.textContent = t('lb.you');
        who.append(you);
      }
      const level = document.createElement('span');
      level.className = 'leaderboard-level';
      level.textContent = t('app.level', { n: rider.level });
      who.append(level);

      const bar = document.createElement('span');
      bar.className = 'leaderboard-bar';
      const fill = document.createElement('span');
      fill.style.width = `${(rider[key] / top) * 100}%`;
      bar.append(fill);

      const value = document.createElement('span');
      value.className = 'leaderboard-value';
      value.textContent = rider[key] > 0 ? METRICS[key].format(rider) : t('lb.noRides');

      li.append(rankEl, who, value, bar);
      listEl.append(li);
    });
  }

  async function refresh() {
    try {
      board = await getLeaderboard(choice.period);
    } catch (err) {
      board = null;
      listEl.innerHTML = '';
      rangeEl.textContent = t('lb.loadFailed', { error: err.message });
      return;
    }
    render();
  }

  function choose(change) {
    const periodChanged = change.period && change.period !== choice.period;
    choice = { ...choice, ...change };
    try { localStorage.setItem(STORAGE, JSON.stringify(choice)); } catch { /* storage off */ }
    markPressed();
    if (periodChanged) refresh();
    else render();
  }

  periodGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) choose({ period: btn.dataset.value });
  });
  metricGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) choose({ metric: btn.dataset.value });
  });
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'home') refresh();
  });

  markPressed();
  refresh();
  return { refresh };
}
