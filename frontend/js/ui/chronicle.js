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

// Calendar keys use the LOCAL date: a ride at 23:30 belongs to that evening
// in the rider's timezone, not to the next UTC day.
function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  const calendarGridEl = document.getElementById('calendar-grid');
  const calendarWeekdaysEl = document.getElementById('calendar-weekdays');
  const calendarMonthEl = document.getElementById('calendar-month');
  const calendarTotalsEl = document.getElementById('calendar-totals');
  const clearFilterBtn = document.getElementById('clear-day-filter');
  const listEl = document.getElementById('chronicle-list');
  const summaryEl = document.getElementById('chronicle-summary');
  const weeklyCanvas = document.getElementById('weekly-chart');
  const rideCanvas = document.getElementById('ride-chart');
  const detailTitleEl = document.getElementById('ride-detail-title');
  const detailStatsEl = document.getElementById('ride-detail-stats');

  let sessions = [];
  let viewMonth = new Date(); // which month the calendar is showing
  let selectedDay = null; // 'YYYY-MM-DD' when a day filters the list

  // Monday-first weekday headings, taken from the browser's locale.
  const weekdayNames = (() => {
    const base = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
    });
  })();

  function ridesByDay() {
    const map = new Map();
    for (const s of sessions) {
      const d = new Date(s.started_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKey(d);
      const entry = map.get(key) ?? { rides: 0, minutes: 0, distance: 0 };
      entry.rides += 1;
      entry.minutes += durationMinutes(s);
      entry.distance += s.distance_m ?? 0;
      map.set(key, entry);
    }
    return map;
  }

  function renderCalendar() {
    const byDay = ridesByDay();
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();

    calendarMonthEl.textContent = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    calendarWeekdaysEl.innerHTML = '';
    for (const name of weekdayNames) {
      const el = document.createElement('span');
      el.textContent = name;
      calendarWeekdaysEl.appendChild(el);
    }

    // Start the grid on the Monday on or before the 1st.
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - lead);

    // Scale fill by the busiest day in view, so a light month still reads.
    const monthKeys = [...byDay.keys()].filter((k) => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
    const busiest = Math.max(1, ...monthKeys.map((k) => byDay.get(k).minutes));

    calendarGridEl.innerHTML = '';
    const todayKey = dayKey(new Date());
    let monthRides = 0;
    let monthMinutes = 0;
    let monthDistance = 0;

    for (let i = 0; i < 42; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = dayKey(date);
      const inMonth = date.getMonth() === month;
      const entry = byDay.get(key);

      const cell = document.createElement('div');
      cell.className = 'calendar-day';
      if (!inMonth) cell.classList.add('is-outside');
      if (key === todayKey) cell.classList.add('is-today');
      cell.textContent = String(date.getDate());

      if (entry) {
        cell.classList.add('has-ride');
        // 35%..100% opacity by volume relative to the month's busiest day.
        const strength = 0.35 + 0.65 * Math.min(1, entry.minutes / busiest);
        cell.style.background = `rgba(176, 141, 87, ${strength.toFixed(2)})`;
        cell.title = `${entry.rides} ride${entry.rides > 1 ? 's' : ''} · ${Math.round(entry.minutes)} min`;
        if (entry.rides > 1) {
          const badge = document.createElement('span');
          badge.className = 'day-rides';
          badge.textContent = entry.rides;
          cell.appendChild(badge);
        }
        if (key === selectedDay) cell.classList.add('is-selected');
        cell.addEventListener('click', () => {
          selectedDay = selectedDay === key ? null : key;
          renderCalendar();
          renderList();
        });
        if (inMonth) {
          monthRides += entry.rides;
          monthMinutes += entry.minutes;
          monthDistance += entry.distance;
        }
      }
      calendarGridEl.appendChild(cell);
    }

    calendarTotalsEl.textContent = monthRides === 0
      ? 'No Pushes this month.'
      : `${monthRides} Push${monthRides > 1 ? 'es' : ''} · ${Math.round(monthMinutes)} min · ${(monthDistance / 1000).toFixed(1)} km`;
  }

  function shiftMonth(delta) {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
    renderCalendar();
  }

  function renderSummary() {
    const totalMin = sessions.reduce((sum, s) => sum + durationMinutes(s), 0);
    const totalKm = sessions.reduce((sum, s) => sum + (s.distance_m ?? 0), 0) / 1000;
    summaryEl.textContent = sessions.length === 0
      ? 'No Pushes yet.'
      : `${sessions.length} Pushes · ${Math.round(totalMin)} min · ${totalKm.toFixed(1)} km`;
  }

  function renderList() {
    listEl.innerHTML = '';
    clearFilterBtn.hidden = !selectedDay;
    const visible = selectedDay
      ? sessions.filter((s) => dayKey(new Date(s.started_at)) === selectedDay)
      : sessions;

    if (visible.length === 0) {
      listEl.innerHTML = sessions.length === 0
        ? '<li class="empty">Nothing recorded yet. Ride something.</li>'
        : '<li class="empty">No Pushes on that day.</li>';
      return;
    }
    for (const session of visible) {
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
    renderCalendar();
    renderList();
    requestAnimationFrame(() => drawWeeklyChart(weeklyCanvas, weeklyTotals(sessions)));
  }

  document.getElementById('calendar-prev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('calendar-next').addEventListener('click', () => shiftMonth(1));
  document.getElementById('calendar-today').addEventListener('click', () => {
    viewMonth = new Date();
    renderCalendar();
  });
  clearFilterBtn.addEventListener('click', () => {
    selectedDay = null;
    renderCalendar();
    renderList();
  });
  document.getElementById('chronicle-back-btn').addEventListener('click', () => showView('home'));
  document.getElementById('detail-back-btn').addEventListener('click', () => showView('chronicle'));
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'chronicle') refresh();
  });

  return { refresh };
}
