import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();

describe('deleting a user', () => {
  let server;
  let base;
  let alice;
  let bob;
  let db;
  let users;

  const ride = (start) => ({
    started_at: start,
    ended_at: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
    distance_m: 12000,
    samples: [
      { timestamp_offset_sec: 0, power: 200, cadence: 90, speed: 30 },
      { timestamp_offset_sec: 1, power: 210, cadence: 90, speed: 30 },
    ],
  });

  before(async () => {
    ({ server, base } = await startServer());
    db = (await import('../backend/src/db/index.js')).default;
    users = await import('../backend/src/auth/users.js');
    await addUser('admin', 'admin', { isAdmin: true });
    await addUser('alice', 'a');
    await addUser('bob', 'b');
    alice = await login(base, 'alice', 'a');
    bob = await login(base, 'bob', 'b');

    for (const rider of [alice, bob]) {
      await rider.post('/api/sessions', ride('2026-10-01T18:00:00.000Z'));
      const w = await (await rider.post('/api/workouts', { name: 'Mine', structure: [{ duration_sec: 60, target_ftp_pct: 80, label: 'x' }] })).json();
      await rider.patch(`/api/workouts/${w.id}/starred`, { starred: true });
      await rider.put('/api/profile', { ftp: 250 });
    }
    const library = (await (await bob.get('/api/workouts')).json()).find((w) => w.library);
    await bob.patch(`/api/workouts/${library.id}/starred`, { starred: true });
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('the dry run counts what would go, and deletes nothing', () => {
    const bobId = users.findUserByUsername('bob').id;
    const counts = users.countUserData(bobId);
    assert.equal(counts.rides, 1);
    assert.equal(counts['ride samples'], 2);
    assert.equal(counts.workouts, 1);
    assert.equal(counts.stars, 2, 'his own workout and a library one');
    assert.equal(counts['FTP history entries'], 1);
    assert.ok(counts.logins >= 1);
    assert.ok(users.findUserByUsername('bob'), 'still there');
  });

  test('removes the account and everything of theirs, and nothing of anyone else', async () => {
    const bobId = users.findUserByUsername('bob').id;
    const aliceId = users.findUserByUsername('alice').id;
    const aliceBefore = users.countUserData(aliceId);
    const libraryBefore = db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE library_key IS NOT NULL').get().n;

    const removed = users.deleteUser(bobId);
    assert.equal(removed.rides, 1);

    assert.equal(users.findUserByUsername('bob'), undefined);
    assert.deepEqual(Object.values(users.countUserData(bobId)), [0, 0, 0, 0, 0, 0, 0], 'nothing left behind');
    const orphans = db.prepare(
      'SELECT COUNT(*) AS n FROM session_samples WHERE session_id NOT IN (SELECT id FROM sessions)'
    ).get().n;
    assert.equal(orphans, 0, 'no samples without a ride');
    assert.deepEqual(users.countUserData(aliceId), aliceBefore, "Alice's data is untouched");
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE library_key IS NOT NULL').get().n, libraryBefore, 'the library stays');
  });

  test('their login stops working at once, and they leave the leaderboard', async () => {
    assert.equal((await bob.get('/api/auth/me')).status, 401);
    const board = await (await alice.get('/api/leaderboard')).json();
    assert.ok(!board.riders.some((r) => r.name === 'bob'));
  });

  test('refuses to delete the last admin', () => {
    const adminId = users.findUserByUsername('admin').id;
    assert.throws(() => users.deleteUser(adminId), /only admin/);
    assert.ok(users.findUserByUsername('admin'));
  });
});
