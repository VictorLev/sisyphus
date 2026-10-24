// The Home pickers: choose a route or a workout to ride. Two tabs, the
// rider's starred ones first, then all of them with filters:
//   workouts: name, duration, mine or library
//   routes:   name, distance, climbing (metres up per km)
// Cards start and star; starting closes the picker and hands the choice on.

import { listWorkouts, listRoutes, setWorkoutStarred, setRouteStarred } from '../api/client.js';
import { t, tp } from '../i18n.js';
import { workoutName } from '../workout/names.js';
import { renderWorkoutRow } from './workouts.js';
import { card, routeProfileSvg } from './cards.js';
import { routeMeta } from './routes.js';

const minutesOf = (w) => w.structure.reduce((s, seg) => s + seg.duration_sec, 0) / 60;

const FILTERS = {
  workouts: {
    length: { label: 'picker.duration', options: { any: 'picker.any', short: 'picker.upTo30', medium: 'picker.30to60', long: 'picker.over60' },
      test: (w, v) => v === 'any' || (v === 'short' ? minutesOf(w) <= 30 : v === 'medium' ? minutesOf(w) > 30 && minutesOf(w) <= 60 : minutesOf(w) > 60) },
    source: { label: 'picker.source', options: { any: 'picker.all', mine: 'picker.mine', library: 'workouts.library' },
      test: (w, v) => v === 'any' || (v === 'library') === Boolean(w.library) },
  },
  routes: {
    distance: { label: 'picker.distance', options: { any: 'picker.any', short: 'picker.under10', medium: 'picker.10to30', long: 'picker.over30' },
      test: (r, v) => { const km = r.distance_m / 1000; return v === 'any' || (v === 'short' ? km < 10 : v === 'medium' ? km >= 10 && km <= 30 : km > 30); } },
    climbing: { label: 'picker.climbing', options: { any: 'picker.any', flat: 'picker.flat', hilly: 'picker.hilly', mountain: 'picker.mountain' },
      test: (r, v) => { const perKm = r.ascent_m / Math.max(0.1, r.distance_m / 1000); return v === 'any' || (v === 'flat' ? perKm < 5 : v === 'hilly' ? perKm >= 5 && perKm <= 15 : perKm > 15); } },
  },
};

export function initRidePicker({ onPick }) {
  const dialog = document.getElementById('ride-picker');
  const titleEl = document.getElementById('ride-picker-title');
  const tabs = document.getElementById('ride-picker-tabs');
  const filtersEl = document.getElementById('ride-picker-filters');
  const searchEl = document.getElementById('ride-picker-search');
  const chipsEl = document.getElementById('ride-picker-chips');
  const listEl = document.getElementById('ride-picker-list');
  let kind = 'workouts';
  let tab = 'starred';
  let items = [];
  let filter = {};

  document.getElementById('ride-picker-close').addEventListener('click', () => dialog.close());
  tabs.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tab]');
    if (btn) setTab(btn.dataset.tab);
  });
  searchEl.addEventListener('input', render);

  function setTab(next) {
    tab = next;
    for (const btn of tabs.querySelectorAll('[data-tab]')) btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    filtersEl.hidden = tab !== 'all';
    render();
  }

  function buildChips() {
    chipsEl.innerHTML = '';
    filter = {};
    for (const [key, spec] of Object.entries(FILTERS[kind])) {
      filter[key] = 'any';
      const group = document.createElement('div');
      group.className = 'segmented segmented-small';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', t(spec.label));
      for (const [value, label] of Object.entries(spec.options)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.value = value;
        b.textContent = t(label);
        b.setAttribute('aria-pressed', String(value === 'any'));
        b.addEventListener('click', () => {
          filter[key] = value;
          for (const other of group.children) other.setAttribute('aria-pressed', String(other === b));
          render();
        });
        group.append(b);
      }
      chipsEl.append(group);
    }
  }

  function nameOf(item) {
    return kind === 'workouts' ? workoutName(item) : item.name;
  }

  async function toggleStar(item) {
    try {
      if (kind === 'workouts') await setWorkoutStarred(item.id, !item.starred);
      else await setRouteStarred(item.id, !item.starred);
      item.starred = !item.starred;
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  function pick(item) {
    dialog.close();
    onPick(kind, item);
  }

  function render() {
    let shown = items;
    if (tab === 'starred') {
      shown = items.filter((i) => i.starred);
    } else {
      const q = searchEl.value.trim().toLowerCase();
      shown = items.filter((i) => (!q || nameOf(i).toLowerCase().includes(q))
        && Object.entries(FILTERS[kind]).every(([key, spec]) => spec.test(i, filter[key])));
    }
    listEl.innerHTML = '';
    if (shown.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t(tab === 'starred' ? `picker.noStarred.${kind}` : 'picker.noMatch');
      listEl.append(empty);
      return;
    }
    for (const item of shown) {
      if (kind === 'workouts') {
        listEl.append(renderWorkoutRow(item, { onStart: pick, onToggleStar: toggleStar, compact: true }));
      } else {
        const { li, actions } = card({
          graph: routeProfileSvg(item.profile),
          title: item.name,
          meta: routeMeta(item),
          starred: item.starred,
          onToggleStar: () => toggleStar(item),
        });
        const start = document.createElement('button');
        start.type = 'button';
        start.textContent = t('workouts.start');
        start.addEventListener('click', () => pick(item));
        actions.append(start);
        listEl.append(li);
      }
    }
  }

  return {
    async open(which) {
      kind = which;
      titleEl.textContent = t(`picker.title.${kind}`);
      searchEl.value = '';
      buildChips();
      items = [];
      listEl.innerHTML = '';
      dialog.showModal();
      try {
        // FTP tests start from Profile; routes still uploading can't be ridden.
        items = kind === 'workouts'
          ? (await listWorkouts()).filter((w) => !w.test)
          : (await listRoutes()).filter((r) => r.ready);
      } catch (err) {
        listEl.innerHTML = `<li class="empty"></li>`;
        listEl.firstChild.textContent = err.message;
        return;
      }
      tabs.querySelector('[data-tab="starred"]').textContent = `${t('picker.starred')} (${items.filter((i) => i.starred).length})`;
      tabs.querySelector('[data-tab="all"]').textContent = `${t('picker.all')} (${items.length})`;
      setTab(items.some((i) => i.starred) ? 'starred' : 'all');
    },
  };
}

