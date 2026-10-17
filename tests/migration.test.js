// Upgrading the original single-user database must hand its whole history
// to the first admin with nothing lost or altered. The database is built
// from tests/fixtures/schema-v1.sql, a frozen copy of the schema before
// accounts existed, filled the way the old app filled it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { useTempDb, startServer, client, login } from './helpers.js';

// better-sqlite3 is a backend dependency; resolve it from there.
const Database = createRequire(new URL('../backend/package.json', import.meta.url))('better-sqlite3');
const schemaV1 = readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8');

function seedLegacy(db) {
  const insertWorkout = db.prepare('INSERT INTO workouts (name, structure, starred, created_at) VALUES (?, ?, ?, ?)');
  const sweet = insertWorkout.run('Sweet Spot', JSON.stringify([
    { duration_sec: 600, target_watts: 150, label: 'Warmup' },
    { duration_sec: 1200, target_watts: 160, label: 'SS', grade_percent: 2 },
  ]), 1, '2026-01-01 08:00:00').lastInsertRowid;
  insertWorkout.run('Hills', JSON.stringify([{ duration_sec: 300, target_watts: 180, label: 'Climb' }]), 0, '2026-01-02 08:00:00');

  const insertSession = db.prepare(
    `INSERT INTO sessions (workout_id, workout_name, started_at, ended_at, distance_m, avg_power, max_power, avg_cadence, avg_speed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSample = db.prepare(
    'INSERT INTO session_samples (session_id, timestamp_offset_sec, power, cadence, speed, heart_rate, lap_marker) VALUES (?, ?, ?, ?, ?, ?, 0)'
  );
  const rides = [
    [sweet, 'Sweet Spot', '2026-02-01T18:00:00.000Z', '2026-02-01T18:30:00.000Z', 15000.5, 158.2, 410, 88.1, 30.2],
    [null, null, '2026-02-03T18:00:00.000Z', '2026-02-03T19:05:00.000Z', 33000, 171.9, 650, 90.4, 31.7],
    // A ride whose workout was deleted long ago: only the snapshot remains.
    [null, 'Deleted Template', '2026-02-05T07:00:00.000Z', '2026-02-05T07:20:00.000Z', 9000, 140, 300, 85, 27],
  ];
  for (const r of rides) {
    const id = insertSession.run(...r).lastInsertRowid;
    for (let t = 0; t < 120; t++) insertSample.run(id, t, 100 + (t % 50), 85 + (t % 7), 28 + (t % 3), null);
  }
  db.prepare("INSERT INTO records (metric, value, session_id) VALUES ('peak_power', 650, 2)").run();
  db.prepare("INSERT INTO app_config (key, value) VALUES ('profile', ?)").run(
    JSON.stringify({ name: 'Victor', ftp: 172, weight_kg: 74, max_hr: 190 })
  );
  db.prepare("INSERT INTO app_config (key, value) VALUES ('settings', ?)").run(
    JSON.stringify({ gear_count: 14, max_resistance: 9, default_mode: 'gears' })
  );
}

// Everything a rider would consider "their history", in a comparable form.
function snapshot(db) {
  return {
    workouts: db.prepare('SELECT id, name, structure, created_at FROM workouts WHERE library_key IS NULL ORDER BY id').all(),
    sessions: db.prepare(
      `SELECT id, workout_id, workout_name, started_at, ended_at, distance_m, avg_power, max_power, avg_cadence, avg_speed
       FROM sessions ORDER BY id`
    ).all(),
    samples: db.prepare('SELECT * FROM session_samples ORDER BY session_id, timestamp_offset_sec').all(),
    records: db.prepare('SELECT metric, value, session_id FROM records').all(),
    app_config: db.prepare('SELECT key, value FROM app_config ORDER BY key').all(),
  };
}

describe('upgrading a single-user database', () => {
  const tmp = useTempDb('legacy.db');
  let before_;
  let db;
  let server;
  let base;

  before(async () => {
    const legacy = new Database(tmp.dbPath);
    legacy.pragma('journal_mode = WAL');
    legacy.exec(schemaV1);
    seedLegacy(legacy);
    // The snapshot is taken through the old columns only, so it reads the
    // same before and after the new ones are added.
    before_ = {
      workouts: legacy.prepare('SELECT id, name, structure, created_at FROM workouts ORDER BY id').all(),
      sessions: legacy.prepare(
        `SELECT id, workout_id, workout_name, started_at, ended_at, distance_m, avg_power, max_power, avg_cadence, avg_speed
         FROM sessions ORDER BY id`
      ).all(),
      samples: legacy.prepare('SELECT * FROM session_samples ORDER BY session_id, timestamp_offset_sec').all(),
      records: legacy.prepare('SELECT metric, value, session_id FROM records').all(),
      app_config: legacy.prepare('SELECT key, value FROM app_config ORDER BY key').all(),
    };
    legacy.close();

    // First start of the new version, as deploy/compose.yaml would run it.
    process.env.ADMIN_USERNAME = 'victor';
    process.env.ADMIN_PASSWORD = 'test-only-admin-password';
    db = (await import('../backend/src/db/index.js')).default;
    ({ server, base } = await startServer());
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('creates the admin from the environment, named from the old profile', () => {
    const users = db.prepare('SELECT username, display_name, is_admin FROM users').all();
    assert.deepEqual(users, [{ username: 'victor', display_name: 'Victor', is_admin: 1 }]);
  });

  test('loses and alters nothing', () => {
    assert.deepEqual(snapshot(db), before_);
    assert.equal(before_.samples.length, 360, 'the fixture really had samples to lose');
  });

  test('every old row now belongs to the admin', () => {
    const { id } = db.prepare("SELECT id FROM users WHERE username = 'victor'").get();
    for (const table of ['sessions', 'records']) {
      const owners = db.prepare(`SELECT DISTINCT user_id FROM ${table}`).all().map((r) => r.user_id);
      assert.deepEqual(owners, [id], table);
    }
    const workoutOwners = db.prepare('SELECT DISTINCT user_id FROM workouts WHERE library_key IS NULL').all();
    assert.deepEqual(workoutOwners.map((r) => r.user_id), [id]);
    const unowned = db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE user_id IS NULL AND library_key IS NULL').get();
    assert.equal(unowned.n, 0);
  });

  test('the admin sees their history, profile, settings and stars through the API', async () => {
    const me = await login(base, 'victor', 'test-only-admin-password');

    const sessions = await (await me.get('/api/sessions')).json();
    assert.equal(sessions.length, 3);
    assert.deepEqual(sessions.map((s) => s.workout_name).sort(), ['Deleted Template', 'Sweet Spot', null].sort());

    const detail = await (await me.get(`/api/sessions/${sessions[0].id}`)).json();
    assert.equal(detail.samples.length, 120);

    const profile = await (await me.get('/api/profile')).json();
    assert.equal(profile.ftp, 172);
    assert.equal(profile.name, 'Victor');
    const settings = await (await me.get('/api/settings')).json();
    assert.equal(settings.gear_count, 14);
    assert.equal(settings.default_mode, 'gears');
    assert.equal(settings.sample_interval_sec, 1, 'settings added since still get their defaults');

    const workouts = await (await me.get('/api/workouts')).json();
    const own = workouts.filter((w) => !w.library);
    assert.deepEqual(own.map((w) => [w.name, w.starred]).sort(), [['Hills', false], ['Sweet Spot', true]]);
    assert.ok(workouts.some((w) => w.library), 'and the library alongside');

    const level = await (await me.get('/api/level')).json();
    assert.equal(level.totals.pushes, 3);
    const records = await (await me.get('/api/records')).json();
    assert.equal(records.records.find((r) => r.key === 'peak_power').value, 650);
  });

  test('a second rider starts empty', async () => {
    const { createUser } = await import('../backend/src/auth/users.js');
    await createUser({ username: 'friend', password: 'friend-password' });
    const friend = await login(base, 'friend', 'friend-password');
    assert.deepEqual(await (await friend.get('/api/sessions')).json(), []);
    assert.equal((await (await friend.get('/api/profile')).json()).ftp, 200);
  });

  test('running the migration again changes nothing', async () => {
    const { migrate } = await import('../backend/src/db/migrate.js');
    const beforeRerun = snapshot(db);
    const counts = () => db.prepare(
      `SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM workouts) w,
              (SELECT COUNT(*) FROM workout_stars) st, (SELECT COUNT(*) FROM user_config) c`
    ).get();
    const countsBefore = counts();
    migrate(db, { ...process.env, ADMIN_USERNAME: 'someone-else', ADMIN_PASSWORD: 'another-password' });
    assert.deepEqual(snapshot(db), beforeRerun);
    assert.deepEqual(counts(), countsBefore, 'no second admin, no duplicate library or config');
  });

  test('the logged-out shell still loads', async () => {
    assert.equal((await client(base).get('/api/sessions')).status, 401);
  });
});

describe('upgrading without ADMIN_* set', () => {
  test('keeps the history hidden until an admin is created, then hands it over', async () => {
    const { migrate, claimOrphans } = await import('../backend/src/db/migrate.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'sisyphus-test-'));
    const db = new Database(path.join(dir, 'no-env.db'));
    db.exec(schemaV1);
    seedLegacy(db);

    migrate(db, { NODE_ENV: 'test' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id IS NULL').get().n, 3, 'kept, unowned');
    // Unowned is not the same as library: they must not be shared.
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE library_key IS NOT NULL AND name IN ('Sweet Spot', 'Hills')").get().n,
      0
    );

    // What `npm run add-user -- victor --admin` does.
    db.prepare("INSERT INTO users (username, password_hash, display_name, is_admin) VALUES ('victor', 'x', 'Victor', 1)").run();
    claimOrphans(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id IS NULL').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workout_stars').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_config').get().n, 2);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
