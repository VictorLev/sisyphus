// The Home pickers: choose a route or a workout to ride. Two tabs, the
// rider's starred ones first, then all of them with a search and filters
// (ui/filters.js).
// Cards start and star; starting closes the picker and hands the choice on.

import { listWorkouts, listRoutes, setWorkoutStarred, setRouteStarred } from '../api/client.js';
import { t, tp } from '../i18n.js';
import { renderWorkoutRow } from './workouts.js';
import { card, routeProfileSvg, iconButton } from './cards.js';
import { routeMeta, routeName } from './routes.js';
import { createFilterBar } from './filters.js';

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

  document.getElementById('ride-picker-close').addEventListener('click', () => dialog.close());
  tabs.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tab]');
    if (btn) setTab(btn.dataset.tab);
  });
  const bar = createFilterBar({ searchEl, chipsEl, onChange: () => render() });

  function setTab(next) {
    tab = next;
    for (const btn of tabs.querySelectorAll('[data-tab]')) btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    filtersEl.hidden = tab !== 'all';
    render();
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
      shown = bar.apply(items);
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
      bar.reset();
      bar.build(kind, []);
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
      bar.build(kind, items); // again, now that the routes' continents are known
      tabs.querySelector('[data-tab="starred"]').textContent = `${t('picker.starred')} (${items.filter((i) => i.starred).length})`;
      tabs.querySelector('[data-tab="all"]').textContent = `${t('picker.all')} (${items.length})`;
      setTab(items.some((i) => i.starred) ? 'starred' : 'all');
    },
  };
}

