import { getRecords } from '../api/client.js';

export function initFeats({ onOpenRide }) {
  const totalsEl = document.getElementById('feats-totals');
  const gridEl = document.getElementById('feats-grid');

  function renderTotals(totals) {
    totalsEl.textContent = totals.pushes === 0
      ? 'Nothing to show yet. Ride something.'
      : `${totals.pushes} Pushes · ${totals.minutes} min · ${totals.distance_km} km, all time`;
  }

  function renderRecords(records) {
    gridEl.innerHTML = '';
    for (const record of records) {
      const card = document.createElement('div');
      card.className = 'summary-stat feat-card';
      if (record.value == null) card.classList.add('is-empty');

      const dt = document.createElement('dt');
      dt.textContent = record.label;
      const dd = document.createElement('dd');
      dd.textContent = record.display ?? '—';
      card.appendChild(dt);
      card.appendChild(dd);

      if (record.value == null) {
        // Say why it is empty rather than showing a bare dash: a 20-minute
        // record needs a 20-minute ride.
        const note = document.createElement('p');
        note.className = 'hint';
        note.textContent = 'No ride long enough yet';
        card.appendChild(note);
      } else {
        const note = document.createElement('p');
        note.className = 'hint';
        const when = new Date(record.achieved_at);
        note.textContent = `${record.session_name} · ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
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
      totalsEl.textContent = `Could not load Feats: ${err.message}`;
    }
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'feats') refresh();
  });

  return { refresh };
}
