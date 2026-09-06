-- Sisyphus database schema (Phase 1)
-- See PROMPT.md "Data model" for the rationale behind each table.

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  starred INTEGER NOT NULL DEFAULT 0, -- starred workouts surface on the home screen
  structure TEXT NOT NULL -- JSON: ordered list of { duration_sec, target_watts, label, grade_percent? }
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER REFERENCES workouts(id), -- nullable: free rides have none
  -- The workout's name as it was when ridden. Denormalised on purpose: the
  -- log is permanent, so deleting a workout template must not erase what a
  -- past ride actually was.
  workout_name TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  distance_m REAL,
  avg_power REAL,
  max_power REAL,
  avg_cadence REAL,
  avg_speed REAL
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
  session_id INTEGER REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS strava_tokens (
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER
);

-- Rider profile and app settings, each stored as a single JSON document
-- under a well-known key. Key/value rather than typed columns so new
-- settings never need a migration.
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL, -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
