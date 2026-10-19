-- Sisyphus database schema
-- See PROMPT.md "Data model" for the rationale behind each table.
--
-- Every statement is IF NOT EXISTS, so this runs on every start. Columns
-- added after a table first shipped are ALSO added by db/migrate.js, which
-- is what upgrades an existing database; they are listed here too so a
-- fresh database is created in its final shape. Indexes on those columns
-- live in migrate.js, since they would fail here on an old table that does
-- not have the column yet.

-- Riders. Accounts are created by the admin from the command line; there
-- is no self-signup.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, -- scrypt$N$r$p$salt$hash, see auth/password.js
  display_name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Login sessions. Named auth_sessions because `sessions` is the ride log.
-- Only a SHA-256 of the cookie token is stored, so a copy of the database
-- (a backup, say) cannot be used to log in as anyone.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Superseded by workout_stars (stars are per rider). Kept so old rows
  -- still say what was starred when they are claimed by their owner.
  starred INTEGER NOT NULL DEFAULT 0,
  -- JSON: ordered list of { duration_sec, target_watts | target_ftp_pct, label, grade_percent? }
  structure TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id), -- owner; NULL for library workouts
  -- Set only on the built-in library (db/library.json), which is shared and
  -- read-only. This, not user_id IS NULL, is what marks a library workout,
  -- so a row that has simply not been given an owner yet is never shared.
  library_key TEXT,
  -- JSON, library only: set on FTP tests, e.g. {"kind":"ftp","window_sec":1200,
  -- "factor":0.95}. A ride on such a workout yields an FTP estimate.
  test TEXT
);

CREATE TABLE IF NOT EXISTS workout_stars (
  user_id INTEGER NOT NULL REFERENCES users(id),
  workout_id INTEGER NOT NULL REFERENCES workouts(id),
  PRIMARY KEY (user_id, workout_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER REFERENCES workouts(id), -- nullable: free rides have none
  -- The workout's name as it was when ridden. Denormalised on purpose: the
  -- log is permanent, so deleting a workout template must not erase what a
  -- past ride actually was.
  workout_name TEXT,
  description TEXT, -- the rider's words about the ride, sent along to Strava
  started_at TEXT NOT NULL,
  ended_at TEXT,
  distance_m REAL,
  avg_power REAL,
  max_power REAL,
  avg_cadence REAL,
  avg_speed REAL,
  user_id INTEGER REFERENCES users(id),
  -- The rider's FTP when the ride started. Library workouts are written in
  -- % of FTP, so this is what turns them back into the watts that were
  -- actually chased; NULL for rides from before it was recorded.
  ftp REAL,
  -- The rider's UTC offset in minutes (east positive) when the ride started,
  -- so badges about the day or the hour use their local time. NULL for
  -- rides from before it was recorded, which are read as UTC.
  tz_offset_min INTEGER
);

CREATE TABLE IF NOT EXISTS session_samples (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  timestamp_offset_sec REAL NOT NULL,
  power REAL,
  cadence REAL,
  speed REAL,
  heart_rate REAL, -- unused until an HR strap is added; column reserved so no schema change is needed later
  lap_marker INTEGER NOT NULL DEFAULT 0 -- boolean: 0/1
);

CREATE TABLE IF NOT EXISTS records (
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  session_id INTEGER REFERENCES sessions(id),
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS strava_tokens (
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER
);

-- Single-user profile and settings from before accounts existed. Read once,
-- to give the first admin their old values (see migrate.js), and otherwise
-- left untouched as a record of them.
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL, -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each rider's profile and app settings, each stored as a single JSON
-- document under a well-known key. Key/value rather than typed columns so
-- new settings never need a migration.
CREATE TABLE IF NOT EXISTS user_config (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL, -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

-- Every FTP a rider has had, newest last: from a test (with the ride that
-- measured it) or typed into Profile. Profile's `ftp` stays the current
-- value; this is the history behind it.
CREATE TABLE IF NOT EXISTS ftp_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  ftp REAL NOT NULL,
  previous_ftp REAL,
  source TEXT NOT NULL, -- 'test' | 'manual'
  session_id INTEGER REFERENCES sessions(id), -- the test ride, for source 'test'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One-off migration steps that have run, so they are never repeated.
CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
