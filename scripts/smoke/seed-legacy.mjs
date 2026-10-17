// Writes a database in the pre-accounts shape (tests/fixtures/schema-v1.sql)
// with a few rides, so scripts/smoke-image.sh can check that the built image
// upgrades it. Runs inside the image, using the image's own better-sqlite3:
//
//   docker run --rm -v vol:/data -v $PWD/tests/fixtures:/fixtures:ro \
//     -v $PWD/scripts/smoke:/smoke:ro --entrypoint node <image> /smoke/seed-legacy.mjs
//
// The paths can be overridden to run it outside Docker.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const backendDir = process.env.BACKEND_DIR || '/app/backend';
const fixturesDir = process.env.FIXTURES_DIR || '/fixtures';
const dbPath = process.env.DB_PATH || '/data/sisyphus.db';

const Database = createRequire(path.join(backendDir, 'package.json'))('better-sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // as the old app left it
db.exec(readFileSync(path.join(fixturesDir, 'schema-v1.sql'), 'utf8'));

const workoutId = db.prepare('INSERT INTO workouts (name, structure, starred) VALUES (?, ?, 1)').run(
  'Legacy Intervals',
  JSON.stringify([{ duration_sec: 300, target_watts: 180, label: 'Work' }])
).lastInsertRowid;

const insertSession = db.prepare(
  `INSERT INTO sessions (workout_id, workout_name, started_at, ended_at, distance_m, avg_power, max_power, avg_cadence, avg_speed)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertSample = db.prepare(
  'INSERT INTO session_samples (session_id, timestamp_offset_sec, power, cadence, speed) VALUES (?, ?, ?, ?, ?)'
);
db.transaction(() => {
  for (let day = 1; day <= 3; day++) {
    const id = insertSession.run(
      day === 1 ? workoutId : null, day === 1 ? 'Legacy Intervals' : null,
      `2026-09-0${day}T18:00:00.000Z`, `2026-09-0${day}T18:30:00.000Z`, 15000, 170, 400, 88, 30
    ).lastInsertRowid;
    for (let t = 0; t < 60; t++) insertSample.run(id, t, 150 + t, 85, 29);
  }
})();
db.prepare("INSERT INTO app_config (key, value) VALUES ('profile', ?)").run(JSON.stringify({ name: 'Smoke Rider', ftp: 210 }));
db.close();
console.log(`seeded a pre-accounts database at ${dbPath}`);
