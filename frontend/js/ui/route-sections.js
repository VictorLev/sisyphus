// A route's sections in the ride screen's left column, the way a workout
// shows its steps: climbs (kilometre by kilometre), flats and descents,
// each with its grade and length, coloured from easy to steep with the
// zone colours. The current one is on top, and the foot of the column says
// which it is, its average grade and how far is left of it.

import { ZONES } from '../zones.js';
import { t, num } from '../i18n.js';

const WINDOW = 12; // sections listed at once, from the current one

function colorFor({ kind, grade }) {
  if (kind === 'descent') return ZONES[0].color;
  const steps = [2, 5, 8, 11];
  const i = steps.findIndex((g) => grade < g);
  return ZONES[(i === -1 ? steps.length : i) + 1].color;
}

const gradeText = (grade) => `${grade > 0 ? '▲' : grade < 0 ? '▼' : ''}${num(Math.abs(grade), 1)}%`;
const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${num(m / 1000, 1)} km`);

export function createRouteSections({ listEl, progressEl, targetEl }) {
  const labelEl = targetEl.querySelector('[data-route="label"]');
  const gradeEl = targetEl.querySelector('[data-route="grade"]');
  const leftEl = targetEl.querySelector('[data-route="left"]');
  let sections = [];
  let current = -1;

  function render() {
    listEl.innerHTML = '';
    sections.slice(current, current + WINDOW).forEach((s, offset) => {
      const li = document.createElement('li');
      li.style.setProperty('--zone-color', colorFor(s));
      if (offset === 0) li.classList.add('is-current');
      const grade = document.createElement('span');
      grade.className = 'step-watts';
      grade.textContent = gradeText(s.grade);
      const length = document.createElement('span');
      length.className = 'step-time';
      length.textContent = distanceText(s.to - s.from);
      li.title = t(`live.section.${s.kind}`);
      li.append(grade, length);
      listEl.append(li);
    });
    const more = sections.length - (current + WINDOW);
    if (more > 0) {
      const li = document.createElement('li');
      li.className = 'steps-more';
      li.textContent = t('live.more', { n: more });
      listEl.append(li);
    }
    progressEl.textContent = `${current + 1}/${sections.length}`;
  }

  return {
    start(track) {
      sections = track.sections();
      current = -1;
      targetEl.hidden = false;
      this.update(0);
    },

    update(distanceM) {
      if (sections.length === 0) return;
      let i = sections.findIndex((s) => distanceM < s.to);
      if (i === -1) i = sections.length - 1;
      if (i !== current) {
        current = i;
        render();
      }
      const s = sections[i];
      labelEl.textContent = `${t(`live.section.${s.kind}`)} ${i + 1}/${sections.length}`;
      gradeEl.textContent = gradeText(s.grade);
      leftEl.textContent = distanceText(Math.max(0, s.to - distanceM));
    },

    stop() {
      sections = [];
      current = -1;
      targetEl.hidden = true;
    },
  };
}
