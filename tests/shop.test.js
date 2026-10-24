// Drachmas and the shop: earned from riding and badges, spent on
// cosmetics, worn on Sisyphus and the avatar.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();

const ride = (startIso, minutes) => ({
  started_at: startIso,
  ended_at: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
  distance_m: minutes * 500,
  samples: [{ timestamp_offset_sec: 0, power: 180, cadence: 85, speed: 30 }],
});

describe('shop', () => {
  let server;
  let base;
  let alice;
  let bob;

  before(async () => {
    ({ server, base } = await startServer());
    await addUser('alice', 'a', { displayName: 'Alice' });
    await addUser('bob', 'b', { displayName: 'Bob' });
    alice = await login(base, 'alice', 'a');
    bob = await login(base, 'bob', 'b');
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('a new rider has nothing, and the catalog has prices', async () => {
    const shop = await (await bob.get('/api/shop')).json();
    assert.equal(shop.balance, 0);
    assert.equal(shop.items.length, 19);
    assert.ok(shop.items.every((i) => i.price > 0 && !i.owned));
    assert.deepEqual(shop.equipped, { hat: null, boulder: null, avatar_bg: null, avatar_emblem: null });
  });

  test('riding earns a drachma a minute, and badges add their reward', async () => {
    await alice.post('/api/sessions', ride('2026-03-02T18:00:00.000Z', 120));
    const shop = await (await alice.get('/api/shop')).json();
    assert.equal(shop.earned.riding, 120);
    assert.ok(shop.earned.badges >= 25, 'First Push at least');
    assert.equal(shop.balance, shop.earned.riding + shop.earned.badges);
  });

  test('buying takes drachmas and wears the item; twice, or too poor, is refused', async () => {
    const before = (await (await alice.get('/api/shop')).json()).balance;
    const res = await alice.post('/api/shop/buy', { item_id: 'hat-party' });
    assert.equal(res.status, 201);
    const shop = await res.json();
    assert.equal(shop.balance, before - 100);
    assert.equal(shop.equipped.hat, 'hat-party');
    assert.equal(shop.items.find((i) => i.id === 'hat-party').owned, true);
    assert.equal((await (await alice.post('/api/shop/buy', { item_id: 'hat-party' })).json()).code, 'owned');
    assert.equal((await (await bob.post('/api/shop/buy', { item_id: 'hat-crown' })).json()).code, 'not_enough');
    assert.equal((await alice.post('/api/shop/buy', { item_id: 'nope' })).status, 404);
  });

  test('wear only what you own, in its own slot; take it off', async () => {
    assert.equal((await alice.put('/api/shop/equip', { slot: 'hat', item_id: 'hat-crown' })).status, 403);
    assert.equal((await alice.put('/api/shop/equip', { slot: 'boulder', item_id: 'hat-party' })).status, 400);
    const off = await (await alice.put('/api/shop/equip', { slot: 'hat', item_id: null })).json();
    assert.equal(off.equipped.hat, null);
    assert.equal((await (await alice.put('/api/shop/equip', { slot: 'hat', item_id: 'hat-party' })).json()).equipped.hat, 'hat-party');
  });

  test('the avatar shows on the leaderboard, for everyone', async () => {
    await alice.post('/api/shop/buy', { item_id: 'bg-bronze' });
    const board = await (await bob.get('/api/leaderboard?period=year')).json();
    const a = board.riders.find((r) => r.name === 'Alice');
    assert.deepEqual(a.avatar, { bg: 'bg-bronze', emblem: null });
    const me = await (await alice.get('/api/shop/me')).json();
    assert.equal(me.equipped.avatar_bg, 'bg-bronze');
  });
});
