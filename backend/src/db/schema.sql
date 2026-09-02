-- Sisyphus database schema (Phase 1)
-- See PROMPT.md "Data model" for the rationale behind each table.

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  structure TEXT NOT NULL -- JSON: ordered list of { duration_sec, target_watts, label }
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER REFERENCES workouts(id), -- nullable: free rides have none
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
