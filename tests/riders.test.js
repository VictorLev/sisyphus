// A rider's profile card, as other riders see it from the Leaderboard.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();

describe('rider profile card', () => {
  let server;
  let alice;
  let bob;
  let aliceId;

  const ride = (day, minutes, km, power) => ({
    started_at: `2026-10-${day}T18:00:00.000Z`,
    ended_at: new Date(Date.parse(`2026-10-${day}T18:00:00.000Z`) + minutes * 60_000).toISOString(),
    distance_m: km * 1000,
    samples: [{ timestamp_offset_sec: 0, power, cadence: 85, speed: 30 }, { timestamp_offset_sec: 60, power, cadence: 85, speed: 30 }],
  });

  before(async () => {
    let base;
    ({ server, base } = await startServer());
    await addUser('alice', 'a', { displayName: 'Alice' });
    await addUser('bob', 'b', { displayName: 'Bob' });
    alice = await login(base, 'alice', 'a');
    bob = await login(base, 'bob', 'b');
    await alice.put('/api/profile', { ftp: 245 });
    for (let day = 10; day <= 16; day++) await alice.post('/api/sessions', ride(day, 30 + day, 15 + day, 150 + day));
    await alice.put('/api/shop/equip', { slot: 'hat', item_id: null });
    const board = await (await bob.get('/api/leaderboard?period=year&tz=0')).json();
    aliceId = board.riders.find((r) => r.name === 'Alice').id;
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('the Leaderboard gives each rider\'s id', () => assert.ok(Number.isInteger(aliceId)));

  test('another rider sees FTP, level, badges, feats, the last five rides and the look', async () => {
    const res = await bob.get(`/api/riders/${aliceId}`);
    assert.equal(res.status, 200);
    const card = await res.json();
    assert.equal(card.name, 'Alice');
    assert.equal(card.you, false);
    assert.equal(card.ftp, 245);
    assert.equal(card.level.totals.pushes, 7);
    assert.ok(card.level.level >= 1 && card.level.xp > 0);
    assert.ok(card.badges.earned >= 1 && card.badges.total === 150);
    assert.equal(card.recent.length, 5, 'the last five only');
    assert.equal(card.recent[0].started_at.slice(0, 10), '2026-10-16', 'newest first');
    assert.deepEqual([card.recent[0].minutes, card.recent[0].distance_km], [46, 31]);
    assert.equal(card.feats.find((f) => f.key === 'longest_ride').value, 46 * 60);
    assert.deepEqual(Object.keys(card.costume).sort(), ['boulder', 'hat']);
    assert.deepEqual(Object.keys(card.avatar).sort(), ['bg', 'border', 'emblem']);
  });

  test('nothing private: no username, no ride ids', async () => {
    const text = await (await bob.get(`/api/riders/${aliceId}`)).text();
    assert.doesNotMatch(text, /"alice"/, 'no username');
    assert.doesNotMatch(text, /session_id|"id"/, 'no ride ids');
  });

  test('your own card says so; an unknown rider is a 404', async () => {
    assert.equal((await (await alice.get(`/api/riders/${aliceId}`)).json()).you, true);
    assert.equal((await bob.get('/api/riders/9999')).status, 404);
  });
});
