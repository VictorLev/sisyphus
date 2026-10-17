import { logEvent } from '../log.js';

// The trainer connection, reduced to one button beside the title: it reads
// "Connect trainer", then "Connecting…", then the trainer's name with a lit
// dot. Pressing it while connected disconnects. Failures say so briefly and
// go to Settings → Log with the details.
export function initTrainerButton(trainerConnection) {
  const button = document.getElementById('connect-btn');
  const label = document.getElementById('connect-label');
  let resetTimer = null;

  function show(state, text, title = '') {
    clearTimeout(resetTimer);
    button.dataset.state = state;
    label.textContent = text;
    button.title = title;
  }

  if (!('bluetooth' in navigator)) {
    button.disabled = true;
    show('unavailable', 'No Bluetooth', 'Web Bluetooth needs desktop Chrome (or another Chromium browser).');
    logEvent('warn', 'Web Bluetooth is not available in this browser; the trainer cannot connect.');
    return;
  }

  show('idle', 'Connect trainer');

  button.addEventListener('click', async () => {
    if (button.dataset.state === 'connected') {
      trainerConnection.disconnect();
      return;
    }
    if (button.dataset.state === 'connecting') return;

    show('connecting', 'Connecting…');
    try {
      await trainerConnection.connect();
    } catch (err) {
      // Closing Chrome's device picker is a choice, not a failure.
      if (err?.name === 'NotFoundError' && /cancel/i.test(err.message)) {
        logEvent('info', 'Trainer picker closed without choosing a device.');
        show('idle', 'Connect trainer');
        return;
      }
      logEvent('error', `Trainer connection failed: ${err?.name ?? 'Error'}: ${err?.message ?? err}`);
      show('failed', 'Connection failed', 'See Settings → Log for details.');
      resetTimer = setTimeout(() => show('idle', 'Connect trainer'), 5000);
    }
  });

  trainerConnection.addEventListener('connected', (event) => {
    const name = event.detail.deviceName || 'Trainer';
    logEvent('info', `Trainer connected: ${name}`);
    show('connected', name, 'Connected. Click to disconnect.');
  });

  trainerConnection.addEventListener('disconnected', () => {
    logEvent('warn', 'Trainer disconnected.');
    show('idle', 'Connect trainer');
  });
}
