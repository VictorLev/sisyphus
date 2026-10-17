// Parked rides (saved locally after a failed upload) must only ever be
// retried into the log of the rider who rode them.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// pending.js uses localStorage; a Map-backed stand-in is enough.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { stashRide, pendingCount, flushPending } = await import('../frontend/js/session/pending.js');

beforeEach(() => store.clear());

test("a rider's parked ride is not uploaded for someone else", async () => {
  stashRide({ ride: 'alice-1' }, 1);
  stashRide({ ride: 'bob-1' }, 2);
  assert.equal(pendingCount(1), 1);

  const uploaded = [];
  const result = await flushPending(async (payload) => uploaded.push(payload.ride), 2);
  assert.deepEqual(uploaded, ['bob-1']);
  assert.deepEqual(result, { saved: 1, remaining: 0 });

  // Alice's ride is still waiting for her.
  assert.equal(pendingCount(1), 1);
  await flushPending(async (payload) => uploaded.push(payload.ride), 1);
  assert.deepEqual(uploaded, ['bob-1', 'alice-1']);
  assert.equal(pendingCount(1), 0);
});

test('rides parked before accounts existed are saved by whoever logs in', async () => {
  // The old format had no userId at all.
  store.set('sisyphus.pendingRides', JSON.stringify([{ savedAt: 'x', payload: { ride: 'legacy' } }]));
  const uploaded = [];
  await flushPending(async (payload) => uploaded.push(payload.ride), 7);
  assert.deepEqual(uploaded, ['legacy']);
});

test('a failed retry keeps the ride', async () => {
  stashRide({ ride: 'r' }, 1);
  const result = await flushPending(async () => { throw new Error('still down'); }, 1);
  assert.deepEqual(result, { saved: 0, remaining: 1 });
  assert.equal(pendingCount(1), 1);
});
