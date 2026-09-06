import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || './data/sisyphus.db';

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Additive migrations. CREATE TABLE IF NOT EXISTS leaves an existing table
// untouched, so new columns have to be added explicitly.
const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
if (!sessionColumns.includes('workout_name')) {
  db.exec('ALTER TABLE sessions ADD COLUMN workout_name TEXT');
  // Backfill from the workouts still present, so existing history survives
  // the first workout deletion.
  db.exec(`UPDATE sessions SET workout_name =
             (SELECT name FROM workouts w WHERE w.id = sessions.workout_id)
           WHERE workout_id IS NOT NULL`);
}

export default db;
