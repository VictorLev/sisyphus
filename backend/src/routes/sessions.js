import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

const insertSession = db.prepare(
  `INSERT INTO sessions (workout_id, workout_name, started_at, ended_at, distance_m)
   VALUES (@workout_id, @workout_name, @started_at, @ended_at, @distance_m)`
);
const selectWorkoutName = db.prepare('SELECT name FROM workouts WHERE id = ?');
const insertSample = db.prepare(
  `INSERT INTO session_samples
     (session_id, timestamp_offset_sec, power, cadence, speed, heart_rate, lap_marker)
   VALUES (@session_id, @timestamp_offset_sec, @power, @cadence, @speed, @heart_rate, @lap_marker)`
);
const updateAggregates = db.prepare(
  // Averages are computed over MOVING samples (cadence > 0) so idle time —
  // setup, coasting, resting between efforts — doesn't drag them down. Max
  // power stays over all samples. If a ride somehow had no moving samples,
  // COALESCE falls back to the all-sample average so a real ride never
  // reports null.
  `UPDATE sessions SET
     avg_power = COALESCE(
       (SELECT AVG(power) FROM session_samples WHERE session_id = @id AND cadence > 0),
       (SELECT AVG(power) FROM session_samples WHERE session_id = @id)),
     -- Prefer the client's true peak across every raw BLE reading; samples
     -- hold per-window means, whose max would under-report a short sprint.
     max_power = COALESCE(@max_power,
       (SELECT MAX(power) FROM session_samples WHERE session_id = @id)),
     avg_cadence = COALESCE(
       (SELECT AVG(cadence) FROM session_samples WHERE session_id = @id AND cadence > 0),
       (SELECT AVG(cadence) FROM session_samples WHERE session_id = @id)),
     avg_speed = COALESCE(
       (SELECT AVG(speed) FROM session_samples WHERE session_id = @id AND cadence > 0),
       (SELECT AVG(speed) FROM session_samples WHERE session_id = @id))
   WHERE id = @id`
);
const selectSessionById = db.prepare('SELECT * FROM sessions WHERE id = ?');

// The Chronicle needs the workout's name alongside each session, and a
// duration; both are cheap to derive here rather than in the client.
const selectAllSessions = db.prepare(
  `SELECT s.*, COALESCE(s.workout_name, w.name) AS workout_name,
          (SELECT COUNT(*) FROM session_samples ss WHERE ss.session_id = s.id) AS sample_count
   FROM sessions s
   LEFT JOIN workouts w ON w.id = s.workout_id
   ORDER BY s.started_at DESC`
);
const selectSamples = db.prepare(
  `SELECT timestamp_offset_sec, power, cadence, speed, heart_rate
   FROM session_samples WHERE session_id = ? ORDER BY timestamp_offset_sec`
);

function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return 'samples must be a non-empty array';
  }
  for (const s of samples) {
    if (typeof s !== 'object' || s === null || typeof s.timestamp_offset_sec !== 'number') {
      return 'each sample requires a numeric timestamp_offset_sec';
    }
  }
  return null;
}

const createSession = db.transaction((body) => {
  const info = insertSession.run({
    workout_id: body.workout_id ?? null,
    // Snapshot the name so the ride keeps its identity if the workout is
    // later deleted or renamed.
    workout_name: body.workout_id ? (selectWorkoutName.get(body.workout_id)?.name ?? null) : null,
    started_at: body.started_at,
    ended_at: body.ended_at,
    distance_m: body.distance_m ?? null,
  });
  const sessionId = info.lastInsertRowid;

  for (const s of body.samples) {
    insertSample.run({
      session_id: sessionId,
      timestamp_offset_sec: s.timestamp_offset_sec,
      power: s.power ?? null,
      cadence: s.cadence ?? null,
      speed: s.speed ?? null,
      heart_rate: s.heart_rate ?? null,
      lap_marker: s.lap_marker ? 1 : 0,
    });
  }

  updateAggregates.run({ id: sessionId, max_power: body.max_power ?? null });
  return sessionId;
});

router.post('/', (req, res) => {
  const { started_at, ended_at, samples } = req.body;

  if (typeof started_at !== 'string' || started_at === '') {
    return res.status(400).json({ error: 'started_at is required' });
  }
  if (typeof ended_at !== 'string' || ended_at === '') {
    return res.status(400).json({ error: 'ended_at is required' });
  }
  const samplesError = validateSamples(samples);
  if (samplesError) {
    return res.status(400).json({ error: samplesError });
  }

  const sessionId = createSession(req.body);
  const row = selectSessionById.get(sessionId);
  res.status(201).json(row);
});

// The Chronicle: every Push, newest first.
router.get('/', (req, res) => {
  res.json(selectAllSessions.all());
});

// One session with its full time series, for the ride chart.
router.get('/:id', (req, res) => {
  const session = selectSessionById.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  res.json({ ...session, samples: selectSamples.all(req.params.id) });
});

// Deleting a Push removes its samples too — the log is the source of truth,
// so a mis-recorded ride has to be removable.
const deleteSamples = db.prepare('DELETE FROM session_samples WHERE session_id = ?');
const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
const removeSession = db.transaction((id) => {
  deleteSamples.run(id);
  return deleteSession.run(id).changes;
});

router.delete('/:id', (req, res) => {
  const removed = removeSession(req.params.id);
  if (!removed) return res.status(404).json({ error: 'session not found' });
  res.status(204).end();
});

export default router;
