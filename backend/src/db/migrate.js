import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hashPasswordSync, minPasswordLength, passwordLengthError } from '../auth/password.js';
import { syncLibrary } from './library.js';
import { toPercentOfFtp } from '../workout-structure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{2,32}$/;

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function ensureColumn(db, table, column, definition) {
  if (!columns(db, table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}

// Brings any database, from a fresh file to the original single-user one, up
// to the current shape. Safe to run on every start: each step checks before
// it acts, and running it twice changes nothing.
export function migrate(db, env = {}) {
  db.exec(readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  // Additive migrations. CREATE TABLE IF NOT EXISTS leaves an existing table
  // untouched, so new columns have to be added explicitly.
  if (ensureColumn(db, 'sessions', 'workout_name', 'TEXT')) {
    // Backfill from the workouts still present, so existing history survives
    // the first workout deletion.
    db.exec(`UPDATE sessions SET workout_name =
               (SELECT name FROM workouts w WHERE w.id = sessions.workout_id)
             WHERE workout_id IS NOT NULL`);
  }
  ensureColumn(db, 'workouts', 'starred', 'INTEGER NOT NULL DEFAULT 0');

  // Accounts. Every owned table gains a nullable user_id; existing rows are
  // NULL until claimOrphans() hands them to the first admin.
  ensureColumn(db, 'sessions', 'user_id', 'INTEGER REFERENCES users(id)');
  ensureColumn(db, 'sessions', 'ftp', 'REAL');
  ensureColumn(db, 'sessions', 'tz_offset_min', 'INTEGER');
  ensureColumn(db, 'workouts', 'user_id', 'INTEGER REFERENCES users(id)');
  ensureColumn(db, 'workouts', 'library_key', 'TEXT');
  ensureColumn(db, 'workouts', 'test', 'TEXT');
  ensureColumn(db, 'records', 'user_id', 'INTEGER REFERENCES users(id)');

  db.exec(`
    CREATE INDEX IF NOT EXISTS sessions_user_started ON sessions (user_id, started_at);
    CREATE INDEX IF NOT EXISTS session_samples_session ON session_samples (session_id);
    CREATE INDEX IF NOT EXISTS workouts_user ON workouts (user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS workouts_library_key ON workouts (library_key)
      WHERE library_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions (user_id);
    CREATE INDEX IF NOT EXISTS ftp_history_user ON ftp_history (user_id, id);
  `);

  syncLibrary(db);
  bootstrapAdmin(db, env);
  claimOrphans(db);
  workoutsToPercentOfFtp(db);
}

// Riders' own workouts are stored in % of FTP. Older ones (and any that an
// old client saves in watts) are converted at their owner's FTP, so at that
// FTP every target is the same number of watts as before. Workouts with no
// owner yet wait until claimOrphans gives them one. Idempotent: a converted
// workout has no target_watts left.
function workoutsToPercentOfFtp(db) {
  const rows = db.prepare(
    "SELECT id, user_id, structure FROM workouts WHERE user_id IS NOT NULL AND structure LIKE '%target_watts%'"
  ).all();
  if (rows.length === 0) return;
  const profile = db.prepare("SELECT value FROM user_config WHERE user_id = ? AND key = 'profile'");
  const update = db.prepare('UPDATE workouts SET structure = ? WHERE id = ?');
  const ftpOf = (userId) => {
    try {
      const ftp = Number(JSON.parse(profile.get(userId)?.value ?? '{}').ftp);
      return ftp > 0 ? ftp : 200;
    } catch {
      return 200;
    }
  };
  db.transaction(() => {
    for (const row of rows) {
      update.run(JSON.stringify(toPercentOfFtp(JSON.parse(row.structure), ftpOf(row.user_id))), row.id);
    }
  })();
}

// The first account, from ADMIN_USERNAME / ADMIN_PASSWORD, only while no
// account exists at all. After that the variables are ignored: changing
// ADMIN_PASSWORD later does not change the password (use reset-password).
function bootstrapAdmin(db, env) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;

  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;
  // Without them the server says so at startup (index.js); the CLI scripts
  // also run this, and must not nag while you are creating that account.
  if (!username || !password) return;
  // Fail loudly: a misconfigured first account is better found now than at
  // the login screen.
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('ADMIN_USERNAME must be 2-32 letters, digits, dots, dashes or underscores');
  }
  if (password.length < minPasswordLength()) {
    throw new Error(passwordLengthError('ADMIN_PASSWORD'));
  }

  // The old single-user profile already has the rider's name; use it.
  let displayName = username;
  try {
    const legacy = db.prepare("SELECT value FROM app_config WHERE key = 'profile'").get();
    const name = legacy && JSON.parse(legacy.value).name;
    if (typeof name === 'string' && name.trim()) displayName = name.trim();
  } catch { /* unreadable legacy profile: the username will do */ }

  db.prepare(
    'INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, 1)'
  ).run(username, hashPasswordSync(password), displayName);
  if (env.NODE_ENV !== 'test') console.log(`Created admin account "${username}".`);
}

// Gives every row without an owner to the oldest admin: on an upgrade, that
// is the whole single-user history. Library workouts are not orphans. Runs
// on every start and after the CLI creates an admin, so it does not matter
// in which order the admin and the upgrade arrive.
export function claimOrphans(db) {
  const admin = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
  if (!admin) return;

  db.transaction(() => {
    // Stars move to the per-rider table before the rows are claimed, while
    // "unclaimed" still identifies exactly the legacy workouts.
    db.prepare(
      `INSERT OR IGNORE INTO workout_stars (user_id, workout_id)
       SELECT ?, id FROM workouts WHERE user_id IS NULL AND library_key IS NULL AND starred = 1`
    ).run(admin.id);
    db.prepare('UPDATE workouts SET user_id = ? WHERE user_id IS NULL AND library_key IS NULL').run(admin.id);
    db.prepare('UPDATE sessions SET user_id = ? WHERE user_id IS NULL').run(admin.id);
    db.prepare('UPDATE records SET user_id = ? WHERE user_id IS NULL').run(admin.id);

    // The single-user profile and settings become the admin's, once. The old
    // table is left as it was.
    const done = db.prepare("SELECT 1 FROM migrations WHERE name = 'legacy-app-config'").get();
    if (!done) {
      db.prepare(
        `INSERT OR IGNORE INTO user_config (user_id, key, value, updated_at)
         SELECT ?, key, value, updated_at FROM app_config`
      ).run(admin.id);
      db.prepare("INSERT INTO migrations (name) VALUES ('legacy-app-config')").run();
    }
  })();
}
