import { getFtpEstimate, setFtp, getFtpHistory, listWorkouts, getProfile } from '../api/client.js';
import { zoneForWatts } from '../zones.js';

// The result of an FTP test ride: the estimate, how it compares with the
// rider's current FTP, and the choice to adopt it. Nothing changes until the
// rider presses Update; the test only measures.
export async function showFtpResult(container, sessionId) {
  container.hidden = false;
  container.innerHTML = '<p class="hint">Working out your FTP…</p>';

  let result;
  try {
    result = await getFtpEstimate(sessionId);
  } catch (err) {
    container.innerHTML = '';
    container.append(paragraph('hint', `Could not read the test: ${err.message}`));
    return;
  }

  container.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'FTP Test';
  container.append(heading);

  const minutes = Math.round(result.test.window_sec / 60);
  if (result.estimate_w == null) {
    container.append(paragraph('hint',
      `Not enough data: the test reads your best ${minutes} minutes, and this ride ` +
      `ended before a full ${minutes}-minute effort. Your FTP stays ${result.current_ftp} W.`));
    return;
  }

  const figure = document.createElement('p');
  figure.className = 'ftp-figure';
  figure.textContent = `${result.estimate_w} W`;
  container.append(figure);

  const pct = Math.round(result.test.factor * 100);
  const change = result.estimate_w - result.current_ftp;
  const changePct = result.current_ftp > 0 ? Math.round((change / result.current_ftp) * 100) : 0;
  const delta = change === 0 ? 'the same as now' : `${change > 0 ? '+' : ''}${change} W (${changePct > 0 ? '+' : ''}${changePct}%)`;
  container.append(paragraph('hint',
    `${pct}% of your best ${minutes} minutes (${result.best_average_w} W). ` +
    `Your FTP is ${result.current_ftp} W: ${delta}.`));

  if (result.already_applied) {
    container.append(paragraph('status', 'This result is already your FTP.'));
    return;
  }
  if (change === 0) return;

  const status = paragraph('status', '');
  const actions = document.createElement('div');
  actions.className = 'live-controls';
  const update = document.createElement('button');
  update.type = 'button';
  update.textContent = `Update my FTP to ${result.estimate_w} W`;
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'secondary';
  keep.textContent = `Keep ${result.current_ftp} W`;
  actions.append(update, keep);
  container.append(actions, status);

  update.addEventListener('click', async () => {
    update.disabled = keep.disabled = true;
    try {
      const profile = await setFtp(result.estimate_w, sessionId);
      // The rest of the app (zones, %FTP labels, the builder) listens for this.
      document.dispatchEvent(new CustomEvent('profilechange', { detail: profile }));
      actions.remove();
      status.textContent = `FTP updated to ${profile.ftp} W. Zones and % FTP targets now use it.`;
    } catch (err) {
      status.textContent = `Could not update: ${err.message}`;
      update.disabled = keep.disabled = false;
    }
  });
  keep.addEventListener('click', () => {
    actions.remove();
    status.textContent = `Kept ${result.current_ftp} W. You can apply this result later from the ride in the Chronicle.`;
  });
}

function paragraph(className, text) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

// Profile → FTP History: every FTP the rider has had, newest first.
export function initFtpHistory() {
  const listEl = document.getElementById('ftp-history');

  async function refresh() {
    let entries;
    try {
      entries = await getFtpHistory();
    } catch (err) {
      listEl.innerHTML = '';
      listEl.append(item('empty', `Could not load: ${err.message}`));
      return;
    }
    listEl.innerHTML = '';
    if (entries.length === 0) {
      listEl.append(item('empty', 'No FTP changes yet. Take the FTP Test above to measure yours.'));
      return;
    }
    for (const entry of entries) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'workout-name';
      name.textContent = `${Math.round(entry.ftp)} W`;
      const meta = document.createElement('span');
      meta.className = 'workout-meta';
      const date = new Date(`${entry.created_at.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      const change = entry.previous_ftp != null ? Math.round(entry.ftp - entry.previous_ftp) : null;
      meta.textContent = `${date} · ${entry.source === 'test' ? 'FTP test' : 'set by hand'}` +
        (change ? ` · ${change > 0 ? '+' : ''}${change} W` : '');
      const info = document.createElement('div');
      info.append(name, meta);
      li.append(info);
      listEl.append(li);
    }
  }

  function item(className, text) {
    const li = document.createElement('li');
    li.className = className;
    li.textContent = text;
    return li;
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'profile') refresh();
  });
  // A Profile save or an accepted test changes the history.
  document.addEventListener('profilechange', () => refresh());
  return { refresh };
}

// Profile → FTP Test: the test lives here rather than in the workout list.
// It is still a library workout underneath, so a test ride is an ordinary
// ride in the Chronicle and its result can be read back from there.
//
// The chart and the part-by-part table are both built from the workout's
// segments (their `phase` names), so they can't drift from what is ridden.

// What to do in each part, keyed by the segments' `phase`.
const PHASE_NOTES = {
  'Warm-up': 'Easy spinning to get the legs going.',
  Openers: 'Three 1-minute pushes at your current FTP with easy riding between. They wake the legs up.',
  '5 min hard': 'Hard but controlled. It uses up your short burst of extra energy, so the test measures what you can sustain.',
  Recover: 'Easy. Get your breath back and drink.',
  'The test': 'As hard as you can hold evenly for 20 minutes. The only part that is measured.',
  'Cool-down': 'Easy spinning.',
};
const MEASURED = 'The test';

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const watts = (pct, ftp) => Math.round((pct / 100) * ftp);

// Consecutive segments sharing a phase, with their time span and effort range.
function phasesOf(structure) {
  const phases = [];
  let t = 0;
  for (const seg of structure) {
    const name = seg.phase ?? seg.label;
    const last = phases.at(-1);
    if (last && last.name === name) {
      last.endSec += seg.duration_sec;
      last.minPct = Math.min(last.minPct, seg.target_ftp_pct);
      last.maxPct = Math.max(last.maxPct, seg.target_ftp_pct);
    } else {
      phases.push({ name, startSec: t, endSec: t + seg.duration_sec, minPct: seg.target_ftp_pct, maxPct: seg.target_ftp_pct });
    }
    t += seg.duration_sec;
  }
  return phases;
}

function effortText(phase, ftp) {
  if (phase.name === MEASURED) return `Your best, around ${watts(phase.minPct, ftp)} W or more`;
  if (phase.minPct === phase.maxPct) return `${phase.minPct}% FTP (≈${watts(phase.minPct, ftp)} W)`;
  return `${phase.minPct}–${phase.maxPct}% FTP (≈${watts(phase.minPct, ftp)}–${watts(phase.maxPct, ftp)} W)`;
}

function renderChart(workout, ftp) {
  const chart = document.getElementById('ftp-test-chart');
  const timeEl = document.getElementById('ftp-test-time');
  const readout = document.getElementById('ftp-test-readout');
  const total = workout.structure.reduce((sum, s) => sum + s.duration_sec, 0);
  const ceiling = Math.max(...workout.structure.map((s) => s.target_ftp_pct)) * 1.15;
  const measured = phasesOf(workout.structure).find((p) => p.name === MEASURED);

  chart.innerHTML = '';
  chart.setAttribute('aria-label',
    `Shape of the test: ${Math.round(total / 60)} minutes, power by segment. ` +
    (measured ? `The measured 20 minutes run from minute ${Math.round(measured.startSec / 60)} to ${Math.round(measured.endSec / 60)}. ` : '') +
    'The table below lists every part.');

  // Your FTP as a reference line: everything above it is harder than an hour's effort.
  const ftpLine = document.createElement('span');
  ftpLine.className = 'ftp-test-ftpline';
  ftpLine.style.bottom = `${(100 / ceiling) * 100}%`;
  const ftpLabel = document.createElement('span');
  ftpLabel.textContent = 'Your FTP';
  ftpLine.append(ftpLabel);
  chart.append(ftpLine);

  const defaultText = 'Hover a bar for details.';
  for (const seg of workout.structure) {
    const bar = document.createElement('span');
    bar.className = 'ftp-test-bar';
    bar.tabIndex = 0;
    bar.style.flex = `${seg.duration_sec} 0 0`;
    bar.style.height = `${(seg.target_ftp_pct / ceiling) * 100}%`;
    bar.style.background = zoneForWatts(seg.target_ftp_pct, 100).color;
    const isTest = seg.phase === MEASURED;
    const detail = isTest
      ? `${seg.label} · ${clock(seg.duration_sec)} · as hard as you can hold, around ${watts(seg.target_ftp_pct, ftp)} W or more`
      : `${seg.label} · ${clock(seg.duration_sec)} · ${seg.target_ftp_pct}% FTP ≈ ${watts(seg.target_ftp_pct, ftp)} W`;
    bar.setAttribute('aria-label', detail);
    if (isTest) {
      bar.classList.add('is-measured');
      const tag = document.createElement('span');
      tag.className = 'ftp-test-measured';
      tag.textContent = 'Measured';
      bar.append(tag);
    }
    const show = () => { readout.textContent = detail; };
    const hide = () => { readout.textContent = defaultText; };
    bar.addEventListener('mouseenter', show);
    bar.addEventListener('focus', show);
    bar.addEventListener('mouseleave', hide);
    bar.addEventListener('blur', hide);
    chart.append(bar);
  }
  readout.textContent = defaultText;

  // Minute ticks every 10 minutes, plus the end.
  timeEl.innerHTML = '';
  const ticks = [];
  for (let m = 0; m * 60 < total - 300; m += 10) ticks.push(m * 60);
  ticks.push(total);
  for (const sec of ticks) {
    const tick = document.createElement('span');
    tick.style.left = `${(sec / total) * 100}%`;
    tick.textContent = `${Math.round(sec / 60)} min`;
    timeEl.append(tick);
  }
}

function renderPhases(workout, ftp) {
  const body = document.getElementById('ftp-test-phases');
  body.innerHTML = '';
  for (const phase of phasesOf(workout.structure)) {
    const row = document.createElement('tr');
    if (phase.name === MEASURED) row.className = 'is-measured';
    const cells = [
      `${Math.round(phase.startSec / 60)}–${Math.round(phase.endSec / 60)} min`,
      phase.name,
      `${effortText(phase, ftp)}. ${PHASE_NOTES[phase.name] ?? ''}`.trim(),
    ];
    cells.forEach((text, i) => {
      const cell = document.createElement(i === 1 ? 'th' : 'td');
      if (i === 1) cell.scope = 'row';
      cell.textContent = text;
      row.append(cell);
    });
    body.append(row);
  }
}

export function initFtpTestPanel({ onStart }) {
  const panel = document.getElementById('ftp-test-panel');
  const startBtn = document.getElementById('ftp-test-start-btn');
  let testWorkout = null;
  let ftp = 200;

  function render() {
    if (!testWorkout) return;
    renderChart(testWorkout, ftp);
    renderPhases(testWorkout, ftp);
  }

  async function refresh() {
    try {
      const [workouts, profile] = await Promise.all([listWorkouts(), getProfile()]);
      testWorkout = workouts.find((w) => w.test) ?? null;
      if (profile.ftp > 0) ftp = profile.ftp;
    } catch {
      testWorkout = null;
    }
    panel.hidden = !testWorkout;
    render();
  }

  startBtn.addEventListener('click', () => {
    if (testWorkout) onStart(testWorkout);
  });
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'profile') refresh();
  });
  // A new FTP changes the watts shown.
  document.addEventListener('profilechange', (event) => {
    if (event.detail?.ftp > 0) {
      ftp = event.detail.ftp;
      render();
    }
  });
}
