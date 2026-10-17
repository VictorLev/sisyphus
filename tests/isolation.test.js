// One rider must never see, change or delete another rider's data. Every
// probe below is made by Bob against Alice's ids, and ends by checking that
// Alice's data is exactly as she left it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();

let server;
let alice;
let bob;
let aliceWorkout;
let aliceSession;
let libraryWorkout;

const ride = (overrides = {}) => ({
  started_at: '2026-03-01T10:00:00Z',
  ended_at: '2026-03-01T10:30:00Z',
  distance_m: 12000,
  samples: [
    { timestamp_offset_sec: 0, power: 250, cadence: 90, speed: 32 },
    { timestamp_offset_sec: 1, power: 260, cadence: 91, speed: 33 },
  ],
  ...overrides,
});

before(async () => {
  let base;
  ({ server, base } = await startServer());
  await addUser('alice', 'alice-password');
  await addUser('bob', 'bob-password');
  alice = await login(base, 'alice', 'alice-password');
  bob = await login(base, 'bob', 'bob-password');

  aliceWorkout = await (await alice.post('/api/workouts', {
    name: 'Alice Secret Intervals',
    structure: [{ duration_sec: 60, target_watts: 300, label: 'Hard' }],
  })).json();
  await alice.patch(`/api/workouts/${aliceWorkout.id}/starred`, { starred: true });
  aliceSession = await (await alice.post('/api/sessions', ride({ workout_id: aliceWorkout.id }))).json();
  await alice.put('/api/profile', { name: 'Alice', ftp: 300 });
  await alice.put('/api/settings', { gear_count: 20 });

  libraryWorkout = (await (await alice.get('/api/workouts')).json()).find((w) => w.library);
});

after(() => {
  server?.close();
  tmp.cleanup();
});

describe('workouts', () => {
  test("Bob's list has the library but none of Alice's workouts", async () => {
    const list = await (await bob.get('/api/workouts')).json();
    assert.ok(!list.some((w) => w.id === aliceWorkout.id));
    assert.ok(list.every((w) => w.library), 'only library workouts');
    assert.ok(list.every((w) => !w.starred), "Alice's stars are hers");
  });

  test("Bob cannot read, edit, star, copy or delete Alice's workout", async () => {
    const id = aliceWorkout.id;
    assert.equal((await bob.get(`/api/workouts/${id}`)).status, 404);
    assert.equal((await bob.put(`/api/workouts/${id}`, {
      name: 'Pwned', structure: [{ duration_sec: 1, target_watts: 1, label: 'x' }],
    })).status, 404);
    assert.equal((await bob.patch(`/api/workouts/${id}/starred`, { starred: true })).status, 404);
    assert.equal((await bob.post(`/api/workouts/${id}/copy`)).status, 404);
    assert.equal((await bob.del(`/api/workouts/${id}`)).status, 404);
  });

  test("Alice's workout is untouched", async () => {
    const mine = await (await alice.get(`/api/workouts/${aliceWorkout.id}`)).json();
    assert.equal(mine.name, 'Alice Secret Intervals');
    assert.equal(mine.starred, true);
    assert.deepEqual(mine.structure, aliceWorkout.structure);
  });
});

describe('rides', () => {
  test("Bob's Chronicle is empty and Alice's ride is not reachable", async () => {
    assert.deepEqual(await (await bob.get('/api/sessions')).json(), []);
    assert.equal((await bob.get(`/api/sessions/${aliceSession.id}`)).status, 404);
    assert.equal((await bob.del(`/api/sessions/${aliceSession.id}`)).status, 404);
  });

  test("a ride Bob posts against Alice's workout does not link to it or leak its name", async () => {
    const saved = await (await bob.post('/api/sessions', ride({ workout_id: aliceWorkout.id }))).json();
    assert.equal(saved.workout_id, null);
    assert.equal(saved.workout_name, null);
    await bob.del(`/api/sessions/${saved.id}`);
  });

  test("Bob's Feats and level ignore Alice's rides", async () => {
    const records = await (await bob.get('/api/records')).json();
    assert.equal(records.totals.pushes, 0);
    assert.ok(records.records.every((r) => r.value == null));
    const level = await (await bob.get('/api/level')).json();
    assert.equal(level.xp, 0);
    assert.equal(level.level, 1);
  });

  test("Alice's ride is untouched and still hers", async () => {
    const mine = await (await alice.get(`/api/sessions/${aliceSession.id}`)).json();
    assert.equal(mine.avg_power, 255);
    assert.equal(mine.samples.length, 2);
    assert.equal((await (await alice.get('/api/sessions')).json()).length, 1);
    assert.equal((await (await alice.get('/api/records')).json()).totals.pushes, 1);
    assert.ok((await (await alice.get('/api/level')).json()).xp > 0);
  });
});

describe('profile and settings', () => {
  test("Bob reads the defaults, not Alice's values, and his saves do not touch hers", async () => {
    const profile = await (await bob.get('/api/profile')).json();
    assert.equal(profile.ftp, 200);
    assert.equal(profile.name, '');
    assert.equal((await (await bob.get('/api/settings')).json()).gear_count, 12);

    await bob.put('/api/profile', { ftp: 180 });
    assert.equal((await (await alice.get('/api/profile')).json()).ftp, 300);
    assert.equal((await (await alice.get('/api/settings')).json()).gear_count, 20);
  });
});

describe('library', () => {
  test('is shared, % FTP based and read-only', async () => {
    assert.ok(libraryWorkout, 'the library is seeded');
    assert.ok(libraryWorkout.structure.every((s) => typeof s.target_ftp_pct === 'number'));
    assert.ok(libraryWorkout.structure.every((s) => s.target_watts === undefined));

    for (const rider of [alice, bob]) {
      assert.equal((await rider.put(`/api/workouts/${libraryWorkout.id}`, {
        name: 'Mine now', structure: [{ duration_sec: 1, target_watts: 1, label: 'x' }],
      })).status, 403);
      assert.equal((await rider.del(`/api/workouts/${libraryWorkout.id}`)).status, 403);
    }
    const after = await (await bob.get(`/api/workouts/${libraryWorkout.id}`)).json();
    assert.equal(after.name, libraryWorkout.name);
  });

  test('stars on library workouts are per rider', async () => {
    await alice.patch(`/api/workouts/${libraryWorkout.id}/starred`, { starred: true });
    assert.equal((await (await alice.get(`/api/workouts/${libraryWorkout.id}`)).json()).starred, true);
    assert.equal((await (await bob.get(`/api/workouts/${libraryWorkout.id}`)).json()).starred, false);
    await alice.patch(`/api/workouts/${libraryWorkout.id}/starred`, { starred: false });
  });

  test("copying makes the rider's own editable workout, still in % of FTP", async () => {
    const copy = await (await alice.post(`/api/workouts/${libraryWorkout.id}/copy`)).json();
    assert.equal(copy.library, false);
    assert.equal(copy.name, libraryWorkout.name);
    assert.deepEqual(copy.structure, libraryWorkout.structure, 'same % targets: it keeps scaling with her FTP');
    assert.equal((await alice.put(`/api/workouts/${copy.id}`, { name: 'Edited', structure: copy.structure })).status, 200);
    assert.equal((await bob.get(`/api/workouts/${copy.id}`)).status, 404, "the copy is Alice's alone");
  });

  test('a ride on a library workout links to it and keeps the FTP it was ridden at', async () => {
    const saved = await (await bob.post('/api/sessions', ride({ workout_id: libraryWorkout.id, ftp: 180 }))).json();
    assert.equal(saved.workout_id, libraryWorkout.id);
    assert.equal(saved.workout_name, libraryWorkout.name);
    assert.equal(saved.ftp, 180);
  });
});
