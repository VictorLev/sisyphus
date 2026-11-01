// A rider's profile card, from their name or avatar on the Leaderboard:
// avatar, name, level and XP, FTP and badges, Sisyphus in their hat and
// boulder, their feats and their last five rides.

import { getRider } from '../api/client.js';
import { t, num, date } from '../i18n.js';
import { avatarSvg } from '../shop/avatar.js';
import { sisyphusStill } from './shop.js';
import { recordValue } from './feats.js';
import { rideName } from '../workout/names.js';

const hours = (minutes) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`);

export function initRiderCard() {
  const dialog = document.getElementById('rider-card');
  const bodyEl = document.getElementById('rider-card-body');
  document.getElementById('rider-card-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // A label over a big number.
  const stat = (label, value) => {
    const box = el('div', 'rider-stat');
    box.append(el('span', 'rider-stat-label', label), el('strong', 'rider-stat-value', value));
    return box;
  };

  function render(rider) {
    bodyEl.innerHTML = '';

    // Who: avatar, name, level and the XP to the next one.
    const head = el('div', 'rider-head');
    const avatar = el('div', 'rider-avatar');
    avatar.innerHTML = avatarSvg({ ...rider.avatar, name: rider.name }, { size: 72 });
    const who = el('div', 'rider-who');
    const title = el('h2', null, rider.name);
    if (rider.you) title.append(el('span', 'leaderboard-you', t('lb.you')));
    const lv = rider.level;
    const bar = el('div', 'rider-xp');
    const fill = el('span');
    fill.style.width = `${Math.round(lv.progress * 100)}%`;
    bar.append(fill);
    who.append(
      title,
      el('span', 'rider-level', t('app.level', { n: lv.level })),
      bar,
      el('span', 'hint', t('profile.xpToLevel', { into: num(lv.into_level), needed: num(lv.needed_for_next), next: lv.level + 1 })),
    );
    head.append(avatar, who);

    // Numbers, and Sisyphus as they dressed him.
    const middle = el('div', 'rider-middle');
    const stats = el('div', 'rider-stats');
    stats.append(
      stat(t('riderCard.ftp'), rider.ftp ? `${Math.round(rider.ftp)} W` : '—'),
      stat(t('riderCard.badges'), `${rider.badges.earned} / ${rider.badges.total}`),
      stat(t('riderCard.rides'), num(lv.totals.pushes)),
      stat(t('riderCard.time'), hours(lv.totals.minutes)),
      stat(t('riderCard.distance'), `${num(lv.totals.distance_km, 0)} km`),
    );
    const costume = el('div', 'rider-costume');
    costume.append(sisyphusStill(rider.costume));
    middle.append(stats, costume);

    // Feats: the ones they have.
    const feats = rider.feats.filter((f) => f.value != null);
    const featsEl = el('div', 'rider-section');
    featsEl.append(el('h3', null, t('riderCard.feats')));
    if (feats.length === 0) featsEl.append(el('p', 'hint', t('riderCard.noFeats')));
    else {
      const dl = el('dl', 'rider-feats');
      for (const feat of feats) {
        const row = el('div');
        row.append(el('dt', null, t(`feat.${feat.key}`)), el('dd', null, recordValue(feat)));
        dl.append(row);
      }
      featsEl.append(dl);
    }

    // The last five rides.
    const recentEl = el('div', 'rider-section');
    recentEl.append(el('h3', null, t('riderCard.recent')));
    if (rider.recent.length === 0) recentEl.append(el('p', 'hint', t('riderCard.noRides')));
    else {
      const list = el('ul', 'rider-recent');
      for (const r of rider.recent) {
        const li = el('li');
        li.append(
          el('span', 'rider-recent-name', rideName(r.name) || t('home.freeRide')),
          el('span', 'rider-recent-date', date(r.started_at, { day: 'numeric', month: 'short', year: 'numeric' })),
          el('span', 'rider-recent-stats', [hours(r.minutes), `${num(r.distance_km, 1)} km`, r.avg_power != null ? `${r.avg_power} W` : null].filter(Boolean).join(' · ')),
        );
        list.append(li);
      }
      recentEl.append(list);
    }

    bodyEl.append(head, middle, featsEl, recentEl);
  }

  return {
    async open(id) {
      bodyEl.innerHTML = '';
      bodyEl.append(el('p', 'hint', t('common.loading')));
      dialog.showModal();
      try {
        render(await getRider(id));
      } catch (err) {
        bodyEl.innerHTML = '';
        bodyEl.append(el('p', 'status', err.message));
      }
    },
  };
}
