import { getFtpEstimate, setFtp, getFtpHistory, listWorkouts } from '../api/client.js';

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
export function initFtpTestPanel({ onStart }) {
  const panel = document.getElementById('ftp-test-panel');
  const description = document.getElementById('ftp-test-description');
  const startBtn = document.getElementById('ftp-test-start-btn');
  let testWorkout = null;

  async function refresh() {
    try {
      testWorkout = (await listWorkouts()).find((w) => w.test) ?? null;
    } catch {
      testWorkout = null;
    }
    panel.hidden = !testWorkout;
    if (!testWorkout) return;
    const minutes = Math.round(testWorkout.structure.reduce((sum, s) => sum + s.duration_sec, 0) / 60);
    description.textContent =
      `${minutes} minutes: a warm-up with three short openers, 5 minutes hard to take the edge off, ` +
      `recovery, then 20 minutes all out and a cool-down.`;
  }

  startBtn.addEventListener('click', () => {
    if (testWorkout) onStart(testWorkout);
  });
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'profile') refresh();
  });
}
