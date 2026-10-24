// The phone remote (remote.html, served at /remote): big buttons that shift
// the virtual gears of the ride running in the rider's browser beside the
// bike, with its gear, power, cadence and speed. Shifts and state travel
// through the server (backend/src/routes/remote.js).

import { getMe, login } from './api/client.js';
import { initLanguage, t, num } from './i18n.js';

initLanguage();

const $ = (id) => document.getElementById(id);
const panel = $('remote-panel');
const statusEl = $('remote-status');
const upBtn = $('remote-up');
const downBtn = $('remote-down');
let state = { riding: false };
let wakeLock = null;

function render() {
  const canShift = state.riding && !state.paused && state.mode === 'gears';
  upBtn.disabled = downBtn.disabled = !canShift;
  if (!state.riding) statusEl.textContent = t('remote.waiting');
  else if (state.paused) statusEl.textContent = t('remote.paused');
  else if (state.mode === 'erg') statusEl.textContent = t('remote.erg');
  else if (state.mode === 'rear') statusEl.textContent = t('remote.rear');
  else statusEl.textContent = state.workout || t('home.freeRide');

  $('remote-gear').textContent = state.riding && state.mode === 'gears' ? state.gear : state.mode === 'erg' ? 'ERG' : '--';
  $('remote-power').textContent = state.riding && state.power != null ? `${Math.round(state.power)} W` : '--';
  $('remote-cadence').textContent = state.riding && state.cadence != null ? `${Math.round(state.cadence)} ${t('unit.rpm')}` : '--';
  $('remote-speed').textContent = state.riding && state.speed != null ? `${num(state.speed, 1)} km/h` : '--';
  keepAwake(state.riding);
}

// The phone sleeps after a minute; during a ride the remote must stay on.
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
    }
  } catch { /* not allowed (battery saver, say): the remote still works */ }
}
// The lock goes when the page is hidden; take it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake(state.riding);
});

async function shift(direction) {
  navigator.vibrate?.(15);
  try {
    const res = await fetch('/api/remote/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    });
    if (res.status === 401) return showLogin();
    const { delivered } = await res.json();
    if (!delivered) statusEl.textContent = t('remote.noRide');
  } catch {
    statusEl.textContent = t('remote.offline');
  }
}
upBtn.addEventListener('click', () => shift('up'));
downBtn.addEventListener('click', () => shift('down'));

function connect() {
  const events = new EventSource('/api/remote/events?role=remote');
  events.addEventListener('state', (event) => {
    state = JSON.parse(event.data);
    render();
  });
  events.addEventListener('error', async () => {
    // Reconnects on its own; but a logged-out session never will.
    if ((await getMe().catch(() => undefined)) === null) {
      events.close();
      showLogin();
    } else {
      statusEl.textContent = t('remote.offline');
    }
  });
}

function showLogin() {
  panel.hidden = true;
  $('remote-login').hidden = false;
  $('remote-username').focus();
}

$('remote-login').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await login($('remote-username').value.trim(), $('remote-password').value);
    window.location.reload();
  } catch (err) {
    $('remote-login-status').textContent = err.message;
  }
});

const me = await getMe().catch(() => undefined);
if (me === null) showLogin();
else {
  panel.hidden = false;
  render();
  connect();
}
