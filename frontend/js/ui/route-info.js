// A route's details pop-up, from the ⓘ on its card (Routes page and the
// Home picker): its name, place and numbers, then the best times on it,
// the rider's own five and the five fastest riders. A time counts when
// the ride reached the route's end; it's riding time, pauses left out.

import { getRouteLeaderboard } from '../api/client.js';
import { t, num, date } from '../i18n.js';
import { routeMeta, routeName } from './routes.js';

// "34:12" or "1:05:09".
function clock(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

export function initRouteInfo() {
  const dialog = document.getElementById('route-info');
  const titleEl = document.getElementById('route-info-title');
  const metaEl = document.getElementById('route-info-meta');
  const mineEl = document.getElementById('route-info-mine');
  const everyoneEl = document.getElementById('route-info-everyone');
  document.getElementById('route-info-close').addEventListener('click', () => dialog.close());
  // A click on the dimmed backdrop closes it too.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  // One table: rank, (rider), time, date, average power and speed.
  function fill(tbody, rows, { withName, empty }) {
    tbody.innerHTML = '';
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = withName ? 6 : 5;
      td.className = 'empty';
      td.textContent = empty;
      tr.append(td);
      tbody.append(tr);
      return;
    }
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.you && withName) tr.classList.add('is-you');
      const cells = [
        `${i + 1}`,
        ...(withName ? [r.you ? `${r.name} (${t('lb.you')})` : r.name] : []),
        clock(r.seconds),
        date(r.started_at, { day: 'numeric', month: 'short', year: 'numeric' }),
        r.avg_power != null ? `${Math.round(r.avg_power)} W` : '--',
        r.avg_speed != null ? `${num(r.avg_speed, 1)} km/h` : '--',
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      tr.children[withName ? 2 : 1].className = 'route-info-time';
      tbody.append(tr);
    });
  }

  return {
    async open(route) {
      titleEl.textContent = routeName(route);
      metaEl.textContent = routeMeta(route);
      for (const el of [mineEl, everyoneEl]) el.innerHTML = `<tr><td class="empty" colspan="6">${t('common.loading')}</td></tr>`;
      dialog.showModal();
      try {
        const { mine, everyone } = await getRouteLeaderboard(route.id);
        fill(mineEl, mine, { withName: false, empty: t('routeInfo.noneMine') });
        fill(everyoneEl, everyone, { withName: true, empty: t('routeInfo.noneEveryone') });
      } catch (err) {
        for (const el of [mineEl, everyoneEl]) el.innerHTML = '';
        mineEl.innerHTML = '<tr><td class="empty" colspan="6"></td></tr>';
        mineEl.querySelector('td').textContent = err.message;
      }
    },
  };
}
