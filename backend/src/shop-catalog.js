// What the shop sells. Names and looks live in the frontend (shop.item.<id>
// in the dictionaries, frontend/js/shop/); this is the price list the
// server holds riders to.
//   hat, boulder    — Sisyphus, on the ride screen and in the header
//   avatar_bg,      — the rider's avatar, beside their name and on the
//   avatar_emblem     Leaderboard
export const ITEMS = [
  { id: 'hat-party', slot: 'hat', price: 100 },
  { id: 'hat-laurel', slot: 'hat', price: 150 },
  { id: 'hat-helmet', slot: 'hat', price: 200 },
  { id: 'hat-crown', slot: 'hat', price: 500 },
  { id: 'boulder-donut', slot: 'boulder', price: 200 },
  { id: 'boulder-earth', slot: 'boulder', price: 250 },
  { id: 'boulder-gold', slot: 'boulder', price: 300 },
  { id: 'boulder-disco', slot: 'boulder', price: 400 },
  { id: 'bg-bronze', slot: 'avatar_bg', price: 50 },
  { id: 'bg-slate', slot: 'avatar_bg', price: 50 },
  { id: 'bg-ember', slot: 'avatar_bg', price: 75 },
  { id: 'bg-forest', slot: 'avatar_bg', price: 75 },
  { id: 'bg-royal', slot: 'avatar_bg', price: 100 },
  { id: 'emblem-boulder', slot: 'avatar_emblem', price: 100 },
  { id: 'emblem-wheel', slot: 'avatar_emblem', price: 100 },
  { id: 'emblem-flame', slot: 'avatar_emblem', price: 150 },
  { id: 'emblem-mountain', slot: 'avatar_emblem', price: 150 },
  { id: 'emblem-laurel', slot: 'avatar_emblem', price: 200 },
  { id: 'emblem-crown', slot: 'avatar_emblem', price: 400 },
];
export const SLOTS = ['hat', 'boulder', 'avatar_bg', 'avatar_emblem'];

// Drachmas earned: one per minute ridden, plus a reward per badge (plus any
// an admin gives, up to GIFT_MAX at a time).
export const GIFT_MAX = 1_000_000;
export const PER_MINUTE = 1;
export const BADGE_REWARD = { bronze: 25, silver: 50, gold: 100, fun: 25, secret: 75 };
