// A short walkthrough of the app, shown once after a rider's first login
// (settings.tutorial_done) and again from Settings → Replay the tutorial.
// Each step dims the page, cuts a lit window around one part of it and
// says what it's for in a bubble beside it. Next, Back, Skip (Esc skips).

import { t } from '../i18n.js';
import { showView } from './views.js';

// target: what to light up (null: a centred welcome), view: where it lives.
const STEPS = [
  { target: null, key: 'welcome' },
  { target: '#connect-btn', key: 'connect' },
  { target: '.start-tiles', key: 'start', view: 'home' },
  { target: '.leaderboard-panel', key: 'leaderboard', view: 'home' },
  { target: '#nav-rider', key: 'progress' },
  { target: '[data-nav="settings"]', key: 'settings' },
];

export function initTutorial({ onDone }) {
  const root = document.getElementById('tutorial');
  const spot = root.querySelector('.tutorial-spot');
  const bubble = root.querySelector('.tutorial-bubble');
  const titleEl = root.querySelector('.tutorial-title');
  const textEl = root.querySelector('.tutorial-text');
  const stepEl = root.querySelector('.tutorial-step');
  const backBtn = document.getElementById('tutorial-back');
  const nextBtn = document.getElementById('tutorial-next');
  let index = 0;

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
    // Below the target if there's room, else above; kept on screen.
    const b = bubble.getBoundingClientRect();
    const below = rect.bottom + pad + 12 + b.height < window.innerHeight;
    const top = below ? rect.bottom + pad + 12 : Math.max(12, rect.top - pad - 12 - b.height);
    const left = Math.min(window.innerWidth - b.width - 12, Math.max(12, rect.left + rect.width / 2 - b.width / 2));
    bubble.style.transform = 'none';
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }

  function show(i) {
    index = i;
    const step = STEPS[index];
    if (step.view) showView(step.view);
    titleEl.textContent = t(`tutorial.${step.key}.title`);
    textEl.textContent = t(`tutorial.${step.key}.text`);
    stepEl.textContent = t('tutorial.step', { n: index + 1, total: STEPS.length });
    backBtn.hidden = index === 0;
    nextBtn.textContent = t(index === STEPS.length - 1 ? 'tutorial.finish' : 'tutorial.next');
    document.querySelector(step.target ?? 'body')?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    requestAnimationFrame(place);
    nextBtn.focus();
  }

  function close() {
    root.hidden = true;
    window.removeEventListener('resize', place);
    onDone();
  }

  nextBtn.addEventListener('click', () => (index === STEPS.length - 1 ? close() : show(index + 1)));
  backBtn.addEventListener('click', () => show(Math.max(0, index - 1)));
  document.getElementById('tutorial-skip').addEventListener('click', close);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight') nextBtn.click();
    if (event.key === 'ArrowLeft' && index > 0) backBtn.click();
  });

  return {
    start() {
      root.hidden = false;
      window.addEventListener('resize', place);
      show(0);
    },
  };
}
