import { listSessions, getSession, getWorkout, deleteSession } from '../api/client.js';
import { showView } from './views.js';
import { drawPowerChart, drawWeeklyChart } from './chart.js';

function formatDuration(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function durationMinutes(session) {
  const ms = new Date(session.ended_at) - new Date(session.started_at);
  return Number.isFinite(ms) && ms > 0 ? ms / 60000 : 0;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Buckets sessions into ISO-ish weeks (Monday start) for the totals chart.
function weeklyTotals(sessions, weekCount = 8) {
  const weeks = new Map();
  for (const s of sessions) {
    const d = new Date(s.started_at);
    if (Number.isNaN(d.getTime())) continue;
    const monday = new Date(d);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    monday.setDate(d.getDate() - dow);
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    const entry = weeks.get(key) ?? { key, minutes: 0, distance: 0, rides: 0, date: monday };
    entry.minutes += durationMinutes(s);
    entry.distance += s.distance_m ?? 0;
    entry.rides += 1;
    weeks.set(key, entry);
  }
  return [...weeks.values()]
    .sort((a, b) => a.date - b.date)
    .slice(-weekCount)
    .map((w) => ({
      ...w,
      minutes: Math.round(w.minutes),
      label: w.date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
    }));
}

export function initChronicle() {
  const listEl = document.getElementById('chronicle-list');
  const summaryEl = document.getElementById('chronicle-summary');
  const weeklyCanvas = document.getElementById('weekly-chart');
  const rideCanvas = document.getElementById('ride-chart');
  const detailTitleEl = document.getElementById('ride-detail-title');
  const detailStatsEl = document.getElementById('ride-detail-stats');

  let sessions = [];

  function renderSummary() {
    const totalMin = sessions.reduce((sum, s) => sum + durationMinutes(s), 0);
    const totalKm = sessions.reduce((sum, s) => sum + (s.distance_m ?? 0), 0) / 1000;
    summaryEl.textContent = sessions.length === 0
      ? 'No Pushes yet.'
      : `${sessions.length} Pushes · ${Math.round(totalMin)} min · ${totalKm.toFixed(1)} km`;
  }

  function renderList() {
    listEl.innerHTML = '';
    if (sessions.length === 0) {
      listEl.innerHTML = '<li class="empty">Nothing recorded yet. Ride something.</li>';
      return;
    }
    for (const session of sessions) {
      const li = document.createElement('li');

      const info = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'workout-name';
      name.textContent = session.workout_name || 'Free Ride';
      const meta = document.createElement('span');
      meta.className = 'workout-meta';
      const bits = [
        formatDate(session.started_at),
        formatDuration(session.started_at, session.ended_at),
        `${((session.distance_m ?? 0) / 1000).toFixed(2)} km`,
      ];
      if (session.avg_power != null) bits.push(`${Math.round(session.avg_power)} W avg`);
      meta.textContent = bits.join(' · ');
      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.textContent = 'View';
      viewBtn.addEventListener('click', () => openDetail(session.id));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'secondary';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete this Push from ${formatDate(session.started_at)}? This cannot be undone.`)) return;
        await deleteSession(session.id);
        await refresh();
      });
      actions.appendChild(viewBtn);
      actions.appendChild(delBtn);

      li.appendChild(info);
      li.appendChild(actions);
      listEl.appendChild(li);
    }
  }

  async function openDetail(id) {
    const session = await getSession(id);
    detailTitleEl.textContent = session.workout_name || 'Free Ride';

    const stats = [
      ['Date', formatDate(session.started_at)],
      ['Duration', formatDuration(session.started_at, session.ended_at)],
      ['Distance', `${((session.distance_m ?? 0) / 1000).toFixed(2)} km`],
      ['Avg Power', session.avg_power != null ? `${Math.round(session.avg_power)} W` : '--'],
      ['Max Power', session.max_power != null ? `${Math.round(session.max_power)} W` : '--'],
      ['Avg Cadence', session.avg_cadence != null ? `${Math.round(session.avg_cadence)} rpm` : '--'],
    ];
    detailStatsEl.innerHTML = '';
    for (const [label, value] of stats) {
      const card = document.createElement('div');
      card.className = 'summary-stat';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      card.appendChild(dt);
      card.appendChild(dd);
      detailStatsEl.appendChild(card);
    }

    // If the ride followed a workout, overlay its target steps so the trace
    // can be read against what was being chased.
    let targetSeries = null;
    if (session.workout_id) {
      try {
        const workout = await getWorkout(session.workout_id);
        let cursor = 0;
        targetSeries = workout.structure.map((seg) => {
          const entry = { startSec: cursor, endSec: cursor + seg.duration_sec, watts: seg.target_watts };
          cursor += seg.duration_sec;
          return entry;
        });
      } catch { /* the workout may have been deleted; the trace still stands */ }
    }

    showView('ride-detail');
    // Canvas sizing depends on layout, so draw after the view is visible.
    requestAnimationFrame(() => drawPowerChart(rideCanvas, session.samples, { targetSeries }));
  }

  async function refresh() {
    try {
      sessions = await listSessions();
    } catch (err) {
      summaryEl.textContent = `Could not load the Chronicle: ${err.message}`;
      return;
    }
    renderSummary();
    renderList();
    requestAnimationFrame(() => drawWeeklyChart(weeklyCanvas, weeklyTotals(sessions)));
  }

  document.getElementById('chronicle-back-btn').addEventListener('click', () => showView('home'));
  document.getElementById('detail-back-btn').addEventListener('click', () => showView('chronicle'));
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'chronicle') refresh();
  });

  return { refresh };
}
