// Before any ride starts: is the trainer connected? If not, a pop-up says
// so and offers Connect (the header's connect button does the work, so its
// device picker, states and log stay in one place). The ride starts once
// the trainer connects; Cancel starts nothing.
//
// localStorage "sisyphus.devNoTrainer" = "1" skips the check: for trying
// the ride screens in a browser without Bluetooth (development, tests).

export function initTrainerGate(trainerConnection) {
  const dialog = document.getElementById('trainer-gate');
  const connectBtn = document.getElementById('trainer-gate-connect');
  const cancelBtn = document.getElementById('trainer-gate-cancel');
  const noBluetoothEl = document.getElementById('trainer-gate-no-bluetooth');
  const headerBtn = document.getElementById('connect-btn');
  let connected = false;
  let waiting = null; // resolve() of the pending ensure()

  const finish = (ok) => {
    if (dialog.open) dialog.close();
    waiting?.(ok);
    waiting = null;
  };

  trainerConnection.addEventListener('connected', () => {
    connected = true;
    if (waiting) finish(true);
  });
  trainerConnection.addEventListener('disconnected', () => {
    connected = false;
  });

  connectBtn.addEventListener('click', () => headerBtn.click());
  cancelBtn.addEventListener('click', () => finish(false));
  dialog.addEventListener('cancel', () => finish(false)); // Esc

  function devSkip() {
    try {
      return localStorage.getItem('sisyphus.devNoTrainer') === '1';
    } catch {
      return false;
    }
  }

  return {
    get connected() {
      return connected;
    },
    // Resolves true when it's fine to start the ride.
    ensure() {
      if (connected || devSkip()) return Promise.resolve(true);
      const bluetooth = 'bluetooth' in navigator;
      noBluetoothEl.hidden = bluetooth;
      connectBtn.disabled = !bluetooth;
      dialog.showModal();
      if (bluetooth) connectBtn.focus();
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
  };
}
