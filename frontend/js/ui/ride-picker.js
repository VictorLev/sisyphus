// The Home pickers: choose a route or a workout to ride. Two tabs, the
// rider's starred ones first, then all of them with filters:
//   workouts: name, duration, mine or library
//   routes:   name, distance, climbing (metres up per km)
// Cards start and star; starting closes the picker and hands the choice on.

import { listWorkouts, listRoutes, setWorkoutStarred, setRouteStarred } from '../api/client.js';
import { t, tp, tOr } from '../i18n.js';
import { workoutName } from '../workout/names.js';
import { renderWorkoutRow } from './workouts.js';
import { card, routeProfileSvg, iconButton } from './cards.js';
import { routeMeta, routeName } from './routes.js';

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
    // Only the continents the routes are on (from their route files).
    continent: { label: 'picker.continent', options: (items) => Object.fromEntries([['any', 'picker.anywhere'],
      ...[...new Set(items.map((r) => r.meta?.continent).filter(Boolean))].sort().map((c) => [c, `continent.${c}`])]),
      test: (r, v) => v === 'any' || r.meta?.continent === v },
  },
};

export function initRidePicker({ onPick, ergDefault = () => false }) {
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
      const options = typeof spec.options === 'function' ? spec.options(items) : spec.options;
      if (Object.keys(options).length < 3) continue; // "any" and one other: nothing to choose
      const group = document.createElement('div');
      group.className = 'segmented segmented-small';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', t(spec.label));
      for (const [value, label] of Object.entries(options)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.value = value;
        b.textContent = tOr(label, value); // a continent without a translation shows as is
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
    return kind === 'workouts' ? workoutName(item) : routeName(item);
  }

  // What the search box matches: the name, and for a route both titles and
  // where it is.
  function searchText(item) {
    if (kind === 'workouts') return nameOf(item);
    const m = item.meta ?? {};
    return [item.name, m.title_fr, m.city, m.country, m.continent].filter(Boolean).join(' ');
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

  const ergField = document.getElementById('ride-picker-erg-field');
  const ergBox = document.getElementById('ride-picker-erg');

  function pick(item) {
    dialog.close();
    onPick(kind, item, { erg: kind === 'workouts' && ergBox.checked });
  }

  function render() {
    let shown = items;
    if (tab === 'starred') {
      shown = items.filter((i) => i.starred);
    } else {
      const q = searchEl.value.trim().toLowerCase();
      shown = items.filter((i) => (!q || searchText(i).toLowerCase().includes(q))
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
          image: item.thumbnail,
          title: routeName(item),
          meta: routeMeta(item),
          starred: item.starred,
          onToggleStar: () => toggleStar(item),
        });
        actions.append(iconButton('start', t('workouts.start'), () => pick(item), { primary: true }));
        listEl.append(li);
      }
    }
  }

  return {
    async open(which) {
      kind = which;
      titleEl.textContent = t(`picker.title.${kind}`);
      ergField.hidden = kind !== 'workouts';
      ergBox.checked = ergDefault();
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
      buildChips(); // again, now that the routes' continents are known
      tabs.querySelector('[data-tab="starred"]').textContent = `${t('picker.starred')} (${items.filter((i) => i.starred).length})`;
      tabs.querySelector('[data-tab="all"]').textContent = `${t('picker.all')} (${items.length})`;
      setTab(items.some((i) => i.starred) ? 'starred' : 'all');
    },
  };
}

