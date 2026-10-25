// A search box and filter chips over a list of workouts or routes, shared
// by the Home pickers and the Routes page:
//   workouts: name, duration, mine or library
//   routes:   name or place, distance (< 30, 30–60, > 60 km), climbing
//             (metres up per km), continent

import { t, tOr } from '../i18n.js';
import { workoutName } from '../workout/names.js';

const minutesOf = (w) => w.structure.reduce((s, seg) => s + seg.duration_sec, 0) / 60;

const FILTERS = {
  workouts: {
    length: { label: 'picker.duration', options: { any: 'picker.any', short: 'picker.upTo30', medium: 'picker.30to60', long: 'picker.over60' },
      test: (w, v) => v === 'any' || (v === 'short' ? minutesOf(w) <= 30 : v === 'medium' ? minutesOf(w) > 30 && minutesOf(w) <= 60 : minutesOf(w) > 60) },
    source: { label: 'picker.source', options: { any: 'picker.all', mine: 'picker.mine', library: 'workouts.library' },
      test: (w, v) => v === 'any' || (v === 'library') === Boolean(w.library) },
  },
  routes: {
    // The distance the card shows: the route file's own, if it gives one.
    distance: { label: 'picker.distance', options: { any: 'picker.any', short: 'picker.under30km', medium: 'picker.30to60km', long: 'picker.over60km' },
      test: (r, v) => { const km = r.meta?.distance_km ?? r.distance_m / 1000; return v === 'any' || (v === 'short' ? km < 30 : v === 'medium' ? km >= 30 && km <= 60 : km > 60); } },
    climbing: { label: 'picker.climbing', options: { any: 'picker.any', flat: 'picker.flat', hilly: 'picker.hilly', mountain: 'picker.mountain' },
      test: (r, v) => { const perKm = r.ascent_m / Math.max(0.1, r.distance_m / 1000); return v === 'any' || (v === 'flat' ? perKm < 5 : v === 'hilly' ? perKm >= 5 && perKm <= 15 : perKm > 15); } },
    // Only the continents the routes are on (from their route files).
    continent: { label: 'picker.continent', options: (items) => Object.fromEntries([['any', 'picker.anywhere'],
      ...[...new Set(items.map((r) => r.meta?.continent).filter(Boolean))].sort().map((c) => [c, `continent.${c}`])]),
      test: (r, v) => v === 'any' || r.meta?.continent === v },
  },
};

// What the search box matches: a workout's name; a route's titles and
// where it is.
function searchText(kind, item) {
  if (kind === 'workouts') return workoutName(item);
  const m = item.meta ?? {};
  return [item.name, m.title_fr, m.city, m.country, m.continent].filter(Boolean).join(' ');
}

// onChange runs whenever the search or a chip changes.
export function createFilterBar({ searchEl, chipsEl, onChange }) {
  let kind = 'routes';
  let filter = {};
  searchEl.addEventListener('input', onChange);

  return {
    // Chips for `kind`, from these items (the continents present). A choice
    // still on offer is kept; anything else goes back to "any".
    build(nextKind, items) {
      if (nextKind !== kind) filter = {};
      kind = nextKind;
      chipsEl.innerHTML = '';
      const kept = filter;
      filter = {};
      for (const [key, spec] of Object.entries(FILTERS[kind])) {
        const options = typeof spec.options === 'function' ? spec.options(items) : spec.options;
        filter[key] = kept[key] in options ? kept[key] : 'any';
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
          b.setAttribute('aria-pressed', String(value === filter[key]));
          b.addEventListener('click', () => {
            filter[key] = value;
            for (const other of group.children) other.setAttribute('aria-pressed', String(other === b));
            onChange();
          });
          group.append(b);
        }
        chipsEl.append(group);
      }
    },

    // Back to no search and every chip on "any".
    reset() {
      searchEl.value = '';
      filter = {};
    },

    // The items that match the search and every chip.
    apply(items) {
      const q = searchEl.value.trim().toLowerCase();
      return items.filter((i) => (!q || searchText(kind, i).toLowerCase().includes(q))
        && Object.entries(FILTERS[kind]).every(([key, spec]) => spec.test(i, filter[key] ?? 'any')));
    },
  };
}
