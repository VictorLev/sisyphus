// The shop ("The Agora"): spend drachmas on a hat and a boulder for
// Sisyphus and on an avatar. Each item is a card with a preview (Sisyphus
// wearing it, or the avatar with it), its name and price, and Buy, Wear or
// Take off. Buying wears it at once. The balance in the header follows.

import { getShop, buyItem, equipItem } from '../api/client.js';
import { t, num } from '../i18n.js';
import { drawHat, drawBoulder, setEquipped } from '../shop/cosmetics.js';
import { avatarSvg } from '../shop/avatar.js';
import { createRideHero } from './ride-hero.js';

const SLOT_ORDER = ['hat', 'boulder', 'avatar_bg', 'avatar_emblem'];
const PUSHER = ['..XX..', '..XX..', '.XXXXX', 'XXXX..', '.XXX..', '.XXX..', '.X.X..', 'X...X.'];
const BOULDER = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..'];

// A still of Sisyphus wearing one item, for its card.
function itemPreview(item, equipped) {
  const canvas = document.createElement('canvas');
  const PX = 6;
  canvas.width = 20 * PX;
  canvas.height = 14 * PX;
  canvas.className = 'shop-preview-canvas';
  const ctx = canvas.getContext('2d');
  const px = (x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * PX, y * PX, PX, PX);
  };
  const figure = getComputedStyle(document.documentElement).getPropertyValue('--color-bronze-bright').trim() || '#e0c088';
  for (let x = 0; x < 20; x++) px(x, 13, getComputedStyle(document.documentElement).getPropertyValue('--color-bronze-dim').trim() || '#7a6340');
  PUSHER.forEach((row, y) => [...row].forEach((c, x) => c === 'X' && px(3 + x, 5 + y, figure)));
  drawHat(px, 5, 2, 5, item.slot === 'hat' ? item.id : equipped.hat);
  drawBoulder(px, BOULDER, 10, 5, figure, item.slot === 'boulder' ? item.id : equipped.boulder);
  return canvas;
}

export function initShop({ onChange, getName }) {
  const summaryEl = document.getElementById('shop-summary');
  const earnEl = document.getElementById('shop-earn');
  const avatarEl = document.getElementById('shop-avatar');
  const statusEl = document.getElementById('shop-status');
  const hero = createRideHero(document.getElementById('shop-hero'));
  hero.setZone(3);
  let state = null;

  const setStatus = (text, isError = false) => {
    statusEl.textContent = text;
    statusEl.style.color = isError ? 'var(--color-error)' : '';
  };

  async function act(promise, done) {
    try {
      state = await promise;
      setStatus(done);
      setEquipped(state.equipped);
      onChange?.(state);
      render();
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  function card(item) {
    const li = document.createElement('li');
    li.className = 'card shop-card';
    const look = document.createElement('div');
    look.className = 'shop-look';
    if (item.slot === 'hat' || item.slot === 'boulder') {
      look.append(itemPreview(item, state.equipped));
    } else {
      const bg = item.slot === 'avatar_bg' ? item.id : state.equipped.avatar_bg;
      const emblem = item.slot === 'avatar_emblem' ? item.id : state.equipped.avatar_emblem;
      look.innerHTML = avatarSvg({ bg, emblem, name: getName() }, { size: 64 });
    }
    const body = document.createElement('div');
    body.className = 'card-body';
    const name = document.createElement('span');
    name.className = 'card-title';
    name.textContent = t(`shop.item.${item.id}`);
    const price = document.createElement('span');
    price.className = 'card-meta shop-price';
    price.textContent = item.owned ? t('shop.owned') : t('shop.price', { n: num(item.price) });
    body.append(name, price);
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const worn = state.equipped[item.slot] === item.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    if (!item.owned) {
      btn.textContent = t('shop.buy');
      btn.disabled = state.balance < item.price;
      if (btn.disabled) btn.title = t('shop.needMore', { n: num(item.price - state.balance) });
      btn.addEventListener('click', () => act(buyItem(item.id), t('shop.bought', { name: t(`shop.item.${item.id}`) })));
    } else if (worn) {
      btn.className = 'secondary';
      btn.textContent = t('shop.takeOff');
      btn.addEventListener('click', () => act(equipItem(item.slot, null), ''));
    } else {
      btn.textContent = t('shop.wear');
      btn.addEventListener('click', () => act(equipItem(item.slot, item.id), ''));
    }
    actions.append(btn);
    if (worn) li.classList.add('is-worn');
    li.append(look, body, actions);
    return li;
  }

  function render() {
    summaryEl.textContent = t('shop.balance', { n: num(state.balance) });
    earnEl.textContent = t('shop.earnedSoFar', {
      riding: num(state.earned.riding), badges: num(state.earned.badges), count: state.earned.badge_count, spent: num(state.spent),
      gifts: num(state.earned.gifts ?? 0),
    });
    avatarEl.innerHTML = avatarSvg({ bg: state.equipped.avatar_bg, emblem: state.equipped.avatar_emblem, name: getName() }, { size: 96 });
    for (const slot of SLOT_ORDER) {
      const list = document.querySelector(`.shop-grid[data-slot="${slot}"]`);
      list.innerHTML = '';
      for (const item of state.items.filter((i) => i.slot === slot)) list.append(card(item));
    }
  }

  async function refresh() {
    try {
      state = await getShop();
      setEquipped(state.equipped);
      render();
    } catch (err) {
      summaryEl.textContent = err.message;
    }
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'shop') {
      setStatus('');
      refresh();
    }
  });
  return { refresh };
}
