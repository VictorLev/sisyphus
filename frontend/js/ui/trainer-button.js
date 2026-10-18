import { logEvent } from '../log.js';
import { t } from '../i18n.js';

// Button text follows the language; log entries stay English (bug reports).

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
    show('unavailable', t('trainer.noBluetooth'), t('trainer.noBluetoothTitle'));
    logEvent('warn', 'Web Bluetooth is not available in this browser; the trainer cannot connect.');
    return;
  }

  show('idle', t('trainer.connect'));

  button.addEventListener('click', async () => {
    if (button.dataset.state === 'connected') {
      trainerConnection.disconnect();
      return;
    }
    if (button.dataset.state === 'connecting') return;

    show('connecting', t('trainer.connecting'));
    try {
      await trainerConnection.connect();
    } catch (err) {
      // Closing Chrome's device picker is a choice, not a failure.
      if (err?.name === 'NotFoundError' && /cancel/i.test(err.message)) {
        logEvent('info', 'Trainer picker closed without choosing a device.');
        show('idle', t('trainer.connect'));
        return;
      }
      logEvent('error', `Trainer connection failed: ${err?.name ?? 'Error'}: ${err?.message ?? err}`);
      show('failed', t('trainer.failed'), t('trainer.failedTitle'));
      resetTimer = setTimeout(() => show('idle', t('trainer.connect')), 5000);
    }
  });

  trainerConnection.addEventListener('connected', (event) => {
    const name = event.detail.deviceName || t('trainer.generic');
    logEvent('info', `Trainer connected: ${name}`);
    show('connected', name, t('trainer.connectedTitle'));
  });

  trainerConnection.addEventListener('disconnected', () => {
    logEvent('warn', 'Trainer disconnected.');
    show('idle', t('trainer.connect'));
  });
}
