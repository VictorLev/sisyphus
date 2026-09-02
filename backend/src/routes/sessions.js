import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

const insertSession = db.prepare(
  `INSERT INTO sessions (workout_id, started_at, ended_at, distance_m)
   VALUES (@workout_id, @started_at, @ended_at, @distance_m)`
);
const insertSample = db.prepare(
  `INSERT INTO session_samples
     (session_id, timestamp_offset_sec, power, cadence, speed, heart_rate, lap_marker)
   VALUES (@session_id, @timestamp_offset_sec, @power, @cadence, @speed, @heart_rate, @lap_marker)`
);
const updateAggregates = db.prepare(
  `UPDATE sessions SET
     avg_power = (SELECT AVG(power) FROM session_samples WHERE session_id = @id),
     max_power = (SELECT MAX(power) FROM session_samples WHERE session_id = @id),
     avg_cadence = (SELECT AVG(cadence) FROM session_samples WHERE session_id = @id),
     avg_speed = (SELECT AVG(speed) FROM session_samples WHERE session_id = @id)
   WHERE id = @id`
);
const selectSessionById = db.prepare('SELECT * FROM sessions WHERE id = ?');

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

  updateAggregates.run({ id: sessionId });
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

export default router;
