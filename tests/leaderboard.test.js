import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';
import { periodRange } from '../backend/src/periods.js';

const tmp = useTempDb();

describe('periods', () => {
  test('a week runs Monday to Monday in the viewer\'s time zone', () => {
    // Friday 17 Oct 2026, 22:00 in Montréal (UTC-4) is already Saturday in UTC.
    const now = Date.parse('2026-10-18T02:00:00Z');
    assert.deepEqual(periodRange('week', -240, now), { from: '2026-10-12T04:00:00.000Z', to: '2026-10-19T04:00:00.000Z' });
    assert.deepEqual(periodRange('week', 0, now), { from: '2026-10-12T00:00:00.000Z', to: '2026-10-19T00:00:00.000Z' });
  });

  test('on a Monday, the week starts that day; a Sunday still belongs to the week before', () => {
    assert.equal(periodRange('week', 0, Date.parse('2026-10-19T08:00:00Z')).from, '2026-10-19T00:00:00.000Z');
    assert.equal(periodRange('week', 0, Date.parse('2026-10-18T23:00:00Z')).from, '2026-10-12T00:00:00.000Z');
  });

  test('a month runs from the 1st to the 1st, also across the new year', () => {
    assert.deepEqual(periodRange('month', -300, Date.parse('2026-12-31T23:00:00Z')),
      { from: '2026-12-01T05:00:00.000Z', to: '2027-01-01T05:00:00.000Z' });
  });

  test('a year runs from 1 January to 1 January in the viewer\'s time zone', () => {
    assert.deepEqual(periodRange('year', -300, Date.parse('2027-01-01T03:00:00Z')),
      { from: '2026-01-01T05:00:00.000Z', to: '2027-01-01T05:00:00.000Z' }, 'still New Year\'s Eve in Montréal');
    assert.equal(periodRange('year', 0, Date.parse('2027-01-01T03:00:00Z')).from, '2027-01-01T00:00:00.000Z');
  });
});

describe('leaderboard API', () => {
  let server;
  let alice;
  let bob;

  const ride = (startIso, minutes, km) => ({
    started_at: startIso,
    ended_at: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
    distance_m: km * 1000,
    samples: [{ timestamp_offset_sec: 0, power: 180, cadence: 85, speed: 30 }],
  });

  before(async () => {
    let base;
    ({ server, base } = await startServer());
    await addUser('alice', 'a', { displayName: 'Alice' });
    await addUser('bob', 'b', { displayName: 'Bob' });
    await addUser('carol', 'c', { displayName: 'Carol' });
    alice = await login(base, 'alice', 'a');
    bob = await login(base, 'bob', 'b');

    // Pinned inside the current UTC week (not "an hour ago", which on a
    // Monday just after midnight would fall in the week before).
    const weekStart = Date.parse(periodRange('week', 0).from);
    const inWeek = (h) => new Date(weekStart + h * 3600_000).toISOString();
    await alice.post('/api/sessions', ride(inWeek(10), 60, 30));
    await alice.post('/api/sessions', ride(inWeek(30), 30, 12));
    await bob.post('/api/sessions', ride(inWeek(20), 45, 20));
    // Long ago: counts for the level, never for this week or month.
    await bob.post('/api/sessions', ride('2020-01-06T18:00:00.000Z', 600, 300));
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('lists the riders who rode this week, with their totals; nobody else', async () => {
    const res = await alice.get('/api/leaderboard?period=week&tz=0');
    assert.equal(res.status, 200);
    const board = await res.json();
    assert.equal(board.period, 'week');
    const by = Object.fromEntries(board.riders.map((r) => [r.name, r]));
    assert.deepEqual(Object.keys(by).sort(), ['Alice', 'Bob'], 'Carol has no rides: not listed');
    assert.deepEqual([by.Alice.rides, by.Alice.minutes, by.Alice.distance_km], [2, 90, 42]);
    assert.deepEqual([by.Bob.rides, by.Bob.minutes, by.Bob.distance_km], [1, 45, 20], 'the 2020 ride is not this week');
  });

  test('this year counts this year\'s rides only', async () => {
    const board = await (await alice.get('/api/leaderboard?period=year&tz=0')).json();
    assert.equal(board.period, 'year');
    assert.equal(board.from.slice(5), '01-01T00:00:00.000Z');
    const by = Object.fromEntries(board.riders.map((r) => [r.name, r]));
    assert.ok(by.Bob.minutes <= 45, 'the 2020 ride is not this year');
  });

  test('marks who is asking, and levels come from all-time riding', async () => {
    const board = await (await bob.get('/api/leaderboard?period=month')).json();
    const by = Object.fromEntries(board.riders.map((r) => [r.name, r]));
    assert.equal(by.Bob.you, true);
    assert.equal(by.Alice.you, false);
    assert.ok(by.Bob.level > by.Alice.level, 'Bob\'s old 10-hour ride still counts for his level');
    assert.equal(by.Carol, undefined, 'no rides this month: not listed');
  });

  test('a rider whose rides are all from before the period is not listed in it', async () => {
    const dave = await (async () => {
      await addUser('dave', 'd', { displayName: 'Dave' });
      return login(server.address ? `http://127.0.0.1:${server.address().port}` : '', 'dave', 'd');
    })();
    await dave.post('/api/sessions', ride('2021-03-01T18:00:00.000Z', 60, 30));
    const names = (await (await dave.get('/api/leaderboard?period=year')).json()).riders.map((r) => r.name);
    assert.ok(!names.includes('Dave'), 'not even to himself');
  });

  test('shows display names and totals only', async () => {
    const board = await (await alice.get('/api/leaderboard')).json();
    for (const rider of board.riders) {
      assert.deepEqual(Object.keys(rider).sort(), ['avatar', 'distance_km', 'level', 'minutes', 'name', 'rides', 'you']);
      assert.deepEqual(Object.keys(rider.avatar).sort(), ['bg', 'emblem'], 'only the look they chose');
    }
    assert.ok(!JSON.stringify(board).includes('bob"'), 'no usernames');
  });

  test('needs a login', async () => {
    const res = await fetch(server.address ? `http://127.0.0.1:${server.address().port}/api/leaderboard` : '');
    assert.equal(res.status, 401);
  });
});
