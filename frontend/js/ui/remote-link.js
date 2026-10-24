// The ride page's side of the phone remote (see js/remote.js and
// backend/src/routes/remote.js): shifts from the rider's phone arrive here,
// and while a phone is connected the ride's state (riding, mode, gear,
// numbers) is sent to it: at once when something changes on a shift, and
// otherwise checked once a second and sent only if it changed.

const CHECK_MS = 1000;

export function initRemoteLink({ onShift, getState, onPhones = () => {} }) {
  if (typeof EventSource === 'undefined') return { update() {} };
  let phones = 0;
  let lastSent = null;

  async function send(force = false) {
    if (phones === 0) return;
    const state = getState();
    const json = JSON.stringify(state);
    if (!force && json === lastSent) return;
    lastSent = json;
    try {
      await fetch('/api/remote/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
    } catch { /* the phone catches up on the next change */ }
  }

  const events = new EventSource('/api/remote/events?role=ride');
  events.addEventListener('shift', (event) => onShift(JSON.parse(event.data).direction));
  events.addEventListener('remotes', (event) => {
    const before = phones;
    phones = JSON.parse(event.data).count;
    onPhones(phones);
    if (phones > before) send(true); // a phone just arrived: give it the state now
  });
  setInterval(() => send(), CHECK_MS);

  return { update: () => send() };
}
