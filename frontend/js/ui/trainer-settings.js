// Settings → Trainer: how rides drive the trainer.
//   Rear gears    — shift on the bike; resistance follows the grade only
//   Virtual gears — shift on screen, keyboard or phone; resistance follows
//                   the gear and the grade
// ERG (the trainer holds a workout's watts) is a separate switch below,
// for workouts only.
// The choice lives in the hidden #setting-trainer-mode the settings form
// saves; the buttons set it, and only the fields for that mode show.

import { t } from '../i18n.js';

export const TRAINER_MODES = ['rear', 'gears'];

export function initTrainerSettings() {
  const input = document.getElementById('setting-trainer-mode');
  const group = document.getElementById('trainer-mode-group');
  const descriptionEl = document.getElementById('trainer-mode-description');

  function render(mode) {
    const current = TRAINER_MODES.includes(mode) ? mode : 'gears';
    input.value = current;
    for (const btn of group.querySelectorAll('[data-mode]')) {
      const on = btn.dataset.mode === current;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', String(on));
    }
    descriptionEl.textContent = t(`trainer.description.${current}`);
    for (const block of document.querySelectorAll('[data-trainer-mode]')) {
      block.hidden = !block.dataset.trainerMode.split(' ').includes(current);
    }
  }

  group.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-mode]');
    if (!btn || btn.dataset.mode === input.value) return;
    render(btn.dataset.mode);
    // Lights up the Save button like any other edit.
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // The phone remote's address, in full, ready to type or copy.
  const address = `${location.origin}/remote`;
  const link = document.getElementById('remote-address');
  link.href = address;
  link.textContent = address.replace(/^https?:\/\//, '');
  document.getElementById('remote-copy-btn').addEventListener('click', async (event) => {
    try {
      await navigator.clipboard.writeText(address);
      event.target.textContent = t('remote.copied');
    } catch { /* select it by hand */ }
  });

  return { render };
}
