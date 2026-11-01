// A short walkthrough of the app, shown once after a rider's first login
// (settings.tutorial_done) and again from Settings → Replay the tutorial.
// Each step dims the page, cuts a lit window around one part of it and
// says what it's for in a bubble beside it. Next, Back, Skip (Esc skips).
//
// One step is a choice: rear or virtual gears, lit up where it lives in
// Settings → Ride. On the first login it must be made: Next waits for it,
// and Skip or Esc come back to it rather than closing. On a replay the
// current mode is already picked.

import { t } from '../i18n.js';
import { showView } from './views.js';

// target: what to light up (null: a centred welcome), view: where it lives.
const STEPS = [
  { target: null, key: 'welcome' },
  { target: '#connect-btn', key: 'connect' },
  { target: '#trainer-mode-group', key: 'gears', view: 'settings', choice: true },
  { target: '.start-tiles', key: 'start', view: 'home' },
  { target: '.leaderboard-panel', key: 'leaderboard', view: 'home' },
  { target: '#nav-rider', key: 'progress' },
  { target: '[data-nav="settings"]', key: 'settings' },
];

// onChoose(mode) saves a gears choice; getMode() is the current one;
// onStep(step) runs before a step shows (to open the right settings tab).
export function initTutorial({ onDone, onChoose, getMode, onStep = () => {} }) {
  const root = document.getElementById('tutorial');
  const spot = root.querySelector('.tutorial-spot');
  const bubble = root.querySelector('.tutorial-bubble');
  const titleEl = root.querySelector('.tutorial-title');
  const textEl = root.querySelector('.tutorial-text');
  const stepEl = root.querySelector('.tutorial-step');
  const backBtn = document.getElementById('tutorial-back');
  const nextBtn = document.getElementById('tutorial-next');
  const choiceEl = root.querySelector('.tutorial-choice');
  const choiceIndex = STEPS.findIndex((s) => s.choice);
  let index = 0;
  let mustChoose = false; // the first login, until a mode is picked
  let chosen = null;

  function renderChoice() {
    for (const btn of choiceEl.querySelectorAll('[data-mode]')) {
      const on = btn.dataset.mode === chosen;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', String(on));
    }
    nextBtn.disabled = STEPS[index].choice && !chosen;
  }

  choiceEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-mode]');
    if (!btn) return;
    chosen = btn.dataset.mode;
    mustChoose = false;
    renderChoice();
    onChoose(chosen);
    nextBtn.focus();
  });

  function place() {
    const step = STEPS[index];
    const el = step.target && document.querySelector(step.target);
    const rect = el?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      // A centred bubble, no window.
      spot.hidden = true;
      bubble.style.left = '50%';
      bubble.style.top = '50%';
      bubble.style.transform = 'translate(-50%, -50%)';
      return;
    }
    const pad = 8;
    spot.hidden = false;
    Object.assign(spot.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
    // Below the target if there's room, else above, else beside it (the
    // right if it fits, else the left); kept on screen.
    const b = bubble.getBoundingClientRect();
    const gap = pad + 12;
    const clampX = (x) => Math.min(window.innerWidth - b.width - 12, Math.max(12, x));
    const clampY = (y) => Math.min(window.innerHeight - b.height - 12, Math.max(12, y));
    let top;
    let left = clampX(rect.left + rect.width / 2 - b.width / 2);
    if (rect.bottom + gap + b.height < window.innerHeight) top = rect.bottom + gap;
    else if (rect.top - gap - b.height > 0) top = rect.top - gap - b.height;
    else {
      top = clampY(rect.top + rect.height / 2 - b.height / 2);
      left = clampX(rect.right + gap + b.width < window.innerWidth ? rect.right + gap : rect.left - gap - b.width);
    }
    bubble.style.transform = 'none';
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }

  function show(i) {
    index = i;
    const step = STEPS[index];
    if (step.view) showView(step.view);
    onStep(step);
    titleEl.textContent = t(`tutorial.${step.key}.title`);
    textEl.textContent = t(`tutorial.${step.key}.text`) + (step.choice && mustChoose ? ` ${t('tutorial.gears.required')}` : '');
    choiceEl.hidden = !step.choice;
    stepEl.textContent = t('tutorial.step', { n: index + 1, total: STEPS.length });
    backBtn.hidden = index === 0;
    nextBtn.textContent = t(index === STEPS.length - 1 ? 'tutorial.finish' : 'tutorial.next');
    document.querySelector(step.target ?? 'body')?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    renderChoice();
    requestAnimationFrame(place);
    (step.choice && !chosen ? choiceEl.querySelector('[data-mode]') : nextBtn).focus();
  }

  function close() {
    if (mustChoose) {
      show(choiceIndex); // the gears are not optional the first time
      return;
    }
    root.hidden = true;
    window.removeEventListener('resize', place);
    onDone();
  }

  nextBtn.addEventListener('click', () => (index === STEPS.length - 1 ? close() : show(index + 1)));
  backBtn.addEventListener('click', () => show(Math.max(0, index - 1)));
  document.getElementById('tutorial-skip').addEventListener('click', close);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight' && !nextBtn.disabled) nextBtn.click();
    if (event.key === 'ArrowLeft' && index > 0) backBtn.click();
  });

  return {
    // firstTime: the gears choice must be made before the tour ends.
    start({ firstTime = false } = {}) {
      mustChoose = firstTime;
      chosen = firstTime ? null : getMode();
      root.hidden = false;
      window.addEventListener('resize', place);
      show(0);
    },
  };
}
