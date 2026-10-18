import { getRecords } from '../api/client.js';
import { t, tp, num, date } from '../i18n.js';
import { rideName } from '../workout/names.js';

// Records are labelled and formatted here, from their key and raw value, so
// they read in the rider's language.
function recordValue(record) {
  if (record.value == null) return '—';
  if (record.unit === 'time') {
    const m = Math.round(record.value / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  }
  if (record.unit === 'km') return `${num(record.value / 1000, 2)} km`;
  return `${Math.round(record.value)} W`;
}

export function initFeats({ onOpenRide }) {
  const totalsEl = document.getElementById('feats-totals');
  const gridEl = document.getElementById('feats-grid');

  function renderTotals(totals) {
    totalsEl.textContent = totals.pushes === 0
      ? t('feats.nothing')
      : t('feats.totals', { pushes: tp('unit.pushes', totals.pushes), minutes: num(totals.minutes), km: num(totals.distance_km, 1) });
  }

  function renderRecords(records) {
    gridEl.innerHTML = '';
    for (const record of records) {
      const card = document.createElement('div');
      card.className = 'summary-stat feat-card';
      if (record.value == null) card.classList.add('is-empty');

      const dt = document.createElement('dt');
      dt.textContent = t(`feat.${record.key}`);
      const dd = document.createElement('dd');
      dd.textContent = recordValue(record);
      card.appendChild(dt);
      card.appendChild(dd);

      if (record.value == null) {
        // Say why it is empty rather than showing a bare dash: a 20-minute
        // record needs a 20-minute ride.
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = t('feats.noneLongEnough');
        card.appendChild(note);
      } else {
        const note = document.createElement('p');
        note.className = 'hint';
        const when = new Date(record.achieved_at);
        note.textContent = `${rideName(record.session_name) === 'Free Ride' ? t('home.freeRide') : rideName(record.session_name)} · ${date(when, { month: 'short', day: 'numeric' })}`;
        card.appendChild(note);
        card.classList.add('is-clickable');
        card.addEventListener('click', () => onOpenRide(record.session_id));
      }
      gridEl.appendChild(card);
    }
  }

  async function refresh() {
    try {
      const data = await getRecords();
      renderTotals(data.totals);
      renderRecords(data.records);
    } catch (err) {
      totalsEl.textContent = t('feats.loadFailed', { error: err.message });
    }
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'feats') refresh();
  });

  return { refresh };
}
