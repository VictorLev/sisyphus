import { Router } from 'express';
import db from '../db/index.js';
import { ITEMS, SLOTS, PER_MINUTE, BADGE_REWARD } from '../shop-catalog.js';
import { badgesFor } from './badges.js';

// /api/shop: drachmas and cosmetics. The balance is never stored: it is
// what the rider's riding and badges have earned (so every ride ever
// counts, and deleting one takes its drachmas back) minus what they've
// spent. Spending can't go below zero, so a deleted ride can leave a rider
// owing; they simply can't buy until they've ridden it back.

const q = {
  minutes: db.prepare(
    'SELECT COALESCE(SUM((julianday(ended_at) - julianday(started_at)) * 24 * 60), 0) AS m FROM sessions WHERE user_id = ? AND ended_at IS NOT NULL'
  ),
  spent: db.prepare('SELECT COALESCE(SUM(price), 0) AS s FROM purchases WHERE user_id = ?'),
  owned: db.prepare('SELECT item_id FROM purchases WHERE user_id = ?'),
  buy: db.prepare('INSERT INTO purchases (user_id, item_id, price) VALUES (?, ?, ?)'),
  getCosmetics: db.prepare("SELECT value FROM user_config WHERE user_id = ? AND key = 'cosmetics'"),
  putCosmetics: db.prepare(
    `INSERT INTO user_config (user_id, key, value) VALUES (?, 'cosmetics', ?)
     ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ),
};

const byId = new Map(ITEMS.map((i) => [i.id, i]));

// What a rider wears: { hat, boulder, avatar_bg, avatar_emblem }, ids or null.
export function cosmeticsOf(userId) {
  let stored = {};
  try {
    stored = JSON.parse(q.getCosmetics.get(userId)?.value ?? '{}');
  } catch { /* nothing worn */ }
  return Object.fromEntries(SLOTS.map((slot) => [slot, byId.get(stored[slot])?.slot === slot ? stored[slot] : null]));
}

function wallet(userId) {
  const fromRiding = Math.floor(q.minutes.get(userId).m * PER_MINUTE);
  const badges = badgesFor(userId).filter((b) => b.earned);
  const fromBadges = badges.reduce((sum, b) => sum + (BADGE_REWARD[b.tier] ?? 0), 0);
  const spent = q.spent.get(userId).s;
  return { balance: fromRiding + fromBadges - spent, earned: { riding: fromRiding, badges: fromBadges, badge_count: badges.length }, spent };
}

function shopState(userId) {
  const owned = new Set(q.owned.all(userId).map((r) => r.item_id));
  return {
    ...wallet(userId),
    per_minute: PER_MINUTE,
    badge_reward: BADGE_REWARD,
    equipped: cosmeticsOf(userId),
    items: ITEMS.map((item) => ({ ...item, owned: owned.has(item.id) })),
  };
}

const router = Router();

router.get('/', (req, res) => res.json(shopState(req.user.id)));

// Just the balance and what's worn, for the header.
router.get('/me', (req, res) => {
  const { balance } = wallet(req.user.id);
  res.json({ balance, equipped: cosmeticsOf(req.user.id) });
});

const buy = db.transaction((userId, item) => {
  if (q.owned.all(userId).some((r) => r.item_id === item.id)) return 'owned';
  if (wallet(userId).balance < item.price) return 'poor';
  q.buy.run(userId, item.id, item.price);
  return 'ok';
});

router.post('/buy', (req, res) => {
  const item = byId.get(req.body?.item_id);
  if (!item) return res.status(404).json({ error: 'no such item' });
  const result = buy(req.user.id, item);
  if (result === 'owned') return res.status(409).json({ error: 'already yours', code: 'owned' });
  if (result === 'poor') return res.status(409).json({ error: 'not enough drachmas', code: 'not_enough' });
  // Bought means worn, straight away.
  q.putCosmetics.run(req.user.id, JSON.stringify({ ...cosmeticsOf(req.user.id), [item.slot]: item.id }));
  res.status(201).json(shopState(req.user.id));
});

// Wear an item you own in its slot, or take the slot off (item_id null).
router.put('/equip', (req, res) => {
  const { slot, item_id: itemId } = req.body ?? {};
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: `slot must be one of ${SLOTS.join(', ')}` });
  if (itemId != null) {
    const item = byId.get(itemId);
    if (!item || item.slot !== slot) return res.status(400).json({ error: 'that item does not go in that slot' });
    if (!q.owned.all(req.user.id).some((r) => r.item_id === itemId)) return res.status(403).json({ error: 'buy it first' });
  }
  q.putCosmetics.run(req.user.id, JSON.stringify({ ...cosmeticsOf(req.user.id), [slot]: itemId ?? null }));
  res.json(shopState(req.user.id));
});

export default router;
