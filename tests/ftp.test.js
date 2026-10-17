import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';
import { estimateFtp } from '../backend/src/power.js';

const tmp = useTempDb();

let server;
let alice;
let bob;
let ftpTest;
let ordinary;

// A ride at `watts` for `seconds`, one sample a second.
function steadyRide(watts, seconds, extra = {}) {
  return {
    started_at: '2026-04-01T18:00:00Z',
    ended_at: new Date(Date.parse('2026-04-01T18:00:00Z') + seconds * 1000).toISOString(),
    samples: Array.from({ length: seconds }, (_, t) => ({ timestamp_offset_sec: t, power: watts, cadence: 90, speed: 32 })),
    ...extra,
  };
}

before(async () => {
  let base;
  ({ server, base } = await startServer());
  await addUser('alice', 'alice-password');
  await addUser('bob', 'bob-password');
  alice = await login(base, 'alice', 'alice-password');
  bob = await login(base, 'bob', 'bob-password');
  await alice.put('/api/profile', { ftp: 230 });

  const library = await (await alice.get('/api/workouts')).json();
  ftpTest = library.find((w) => w.test);
  ordinary = library.find((w) => w.library && !w.test);
});

after(() => {
  server?.close();
  tmp.cleanup();
});

describe('the estimate itself', () => {
  test('is 95% of the best 20 minutes', () => {
    const samples = Array.from({ length: 1500 }, (_, t) => ({
      timestamp_offset_sec: t,
      // 5 easy minutes, then 20 minutes at 260 W
      power: t < 300 ? 120 : 260,
    }));
    assert.deepEqual(estimateFtp(samples, { window_sec: 1200, factor: 0.95 }), { best_average_w: 260, estimate_w: 247 });
  });

  test('is null when the ride never covered the window', () => {
    const samples = Array.from({ length: 600 }, (_, t) => ({ timestamp_offset_sec: t, power: 300 }));
    assert.equal(estimateFtp(samples, { window_sec: 1200, factor: 0.95 }), null);
  });
});

describe('the library test', () => {
  test('is marked as a 20-minute FTP test and is long enough to hold one', () => {
    assert.ok(ftpTest, 'the library has an FTP test');
    assert.deepEqual(ftpTest.test, { kind: 'ftp', window_sec: 1200, factor: 0.95 });
    const total = ftpTest.structure.reduce((sum, s) => sum + s.duration_sec, 0);
    assert.ok(total >= 1200);
    assert.ok(ftpTest.structure.some((s) => s.duration_sec === 1200), 'has a 20-minute block');
  });

  test('copying it gives an ordinary workout', async () => {
    const copy = await (await alice.post(`/api/workouts/${ftpTest.id}/copy`)).json();
    assert.equal(copy.test, null);
  });
});

describe('estimate endpoint', () => {
  test('reads the FTP from a test ride', async () => {
    const ride = await (await alice.post('/api/sessions', steadyRide(250, 1300, { workout_id: ftpTest.id, ftp: 230 }))).json();
    const res = await alice.get(`/api/ftp/estimate/${ride.id}`);
    assert.equal(res.status, 200);
    const estimate = await res.json();
    assert.equal(estimate.best_average_w, 250);
    assert.equal(estimate.estimate_w, 238);
    assert.equal(estimate.current_ftp, 230);
    assert.equal(estimate.already_applied, false);
  });

  test('says when the test ended too early', async () => {
    const ride = await (await alice.post('/api/sessions', steadyRide(250, 600, { workout_id: ftpTest.id }))).json();
    const estimate = await (await alice.get(`/api/ftp/estimate/${ride.id}`)).json();
    assert.equal(estimate.estimate_w, null);
  });

  test('refuses rides that were not tests, and other riders\' rides', async () => {
    const plain = await (await alice.post('/api/sessions', steadyRide(200, 1300, { workout_id: ordinary.id }))).json();
    assert.equal((await alice.get(`/api/ftp/estimate/${plain.id}`)).status, 400);

    const test = await (await alice.post('/api/sessions', steadyRide(250, 1300, { workout_id: ftpTest.id }))).json();
    assert.equal((await bob.get(`/api/ftp/estimate/${test.id}`)).status, 404);
  });
});

describe('setting the FTP and its history', () => {
  test('accepting a test result updates the profile and records it against the ride', async () => {
    const ride = await (await alice.post('/api/sessions', steadyRide(260, 1300, { workout_id: ftpTest.id }))).json();
    const res = await alice.post('/api/ftp', { ftp: 247, session_id: ride.id });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ftp, 247);
    assert.equal((await (await alice.get('/api/profile')).json()).ftp, 247);

    const [latest] = await (await alice.get('/api/ftp/history')).json();
    assert.equal(latest.ftp, 247);
    assert.equal(latest.previous_ftp, 230);
    assert.equal(latest.source, 'test');
    assert.equal(latest.session_id, ride.id);

    const estimate = await (await alice.get(`/api/ftp/estimate/${ride.id}`)).json();
    assert.equal(estimate.already_applied, true, 'the summary will not offer it twice');
  });

  test('nothing changes until the rider accepts', async () => {
    const before = (await (await alice.get('/api/profile')).json()).ftp;
    const ride = await (await alice.post('/api/sessions', steadyRide(320, 1300, { workout_id: ftpTest.id }))).json();
    await alice.get(`/api/ftp/estimate/${ride.id}`);
    assert.equal((await (await alice.get('/api/profile')).json()).ftp, before);
  });

  test('a FTP typed into Profile is recorded as manual, and a no-op is not recorded', async () => {
    const count = async () => (await (await alice.get('/api/ftp/history')).json()).length;
    const n = await count();
    await alice.put('/api/profile', { ftp: 255 });
    const [latest] = await (await alice.get('/api/ftp/history')).json();
    assert.equal(latest.source, 'manual');
    assert.equal(latest.ftp, 255);
    assert.equal(await count(), n + 1);

    await alice.put('/api/profile', { ftp: 255, weight_kg: 70 });
    assert.equal(await count(), n + 1, 'saving the same FTP again adds nothing');
  });

  test('rejects nonsense values and another rider\'s ride as evidence', async () => {
    assert.equal((await alice.post('/api/ftp', { ftp: 5 })).status, 400);
    assert.equal((await alice.post('/api/ftp', { ftp: 'fast' })).status, 400);
    const aliceRide = await (await alice.post('/api/sessions', steadyRide(250, 1300, { workout_id: ftpTest.id }))).json();
    assert.equal((await bob.post('/api/ftp', { ftp: 240, session_id: aliceRide.id })).status, 400);
  });

  test('each rider sees only their own history', async () => {
    assert.deepEqual(await (await bob.get('/api/ftp/history')).json(), []);
    assert.ok((await (await alice.get('/api/ftp/history')).json()).length > 0);
  });
});
