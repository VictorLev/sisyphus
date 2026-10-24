import { Router } from 'express';
import db from '../db/index.js';
import { buildTcx } from '../tcx.js';

const router = Router();

const insertSession = db.prepare(
  `INSERT INTO sessions (user_id, workout_id, workout_name, route_id, started_at, ended_at, distance_m, ftp, tz_offset_min)
   VALUES (@user_id, @workout_id, @workout_name, @route_id, @started_at, @ended_at, @distance_m, @ftp, @tz_offset_min)`
);
// Only a workout the rider can see: their own, or the shared library.
const selectRoute = db.prepare('SELECT id, name FROM routes WHERE id = ?');
const selectVisibleWorkout = db.prepare(
  'SELECT id, name FROM workouts WHERE id = ? AND (user_id = ? OR library_key IS NOT NULL)'
);
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
// Every read and delete is scoped to the rider, so another rider's id
// behaves exactly like one that does not exist.
const selectSessionById = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?');

// The Chronicle needs the workout's name alongside each session, and a
// duration; both are cheap to derive here rather than in the client.
const selectAllSessions = db.prepare(
  `SELECT s.*, COALESCE(s.workout_name, w.name) AS workout_name,
          (SELECT COUNT(*) FROM session_samples ss WHERE ss.session_id = s.id) AS sample_count
   FROM sessions s
   LEFT JOIN workouts w ON w.id = s.workout_id
   WHERE s.user_id = ?
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

const createSession = db.transaction((userId, body) => {
  // A workout the rider cannot see is dropped rather than rejected: a ride
  // parked offline may point at a workout deleted since, and the ride
  // itself must still save.
  const workout = body.workout_id ? selectVisibleWorkout.get(body.workout_id, userId) : null;
  // A route ride is named after its route; a deleted route is dropped.
  const route = !workout && body.route_id ? selectRoute.get(body.route_id) : null;
  const ftp = Number(body.ftp);
  // Real offsets run from UTC-12 to UTC+14.
  const tz = Number(body.tz_offset_min);
  const info = insertSession.run({
    user_id: userId,
    workout_id: workout?.id ?? null,
    // Snapshot the name so the ride keeps its identity if the workout is
    // later deleted or renamed.
    workout_name: workout?.name ?? route?.name ?? null,
    route_id: route?.id ?? null,
    started_at: body.started_at,
    ended_at: body.ended_at,
    distance_m: body.distance_m ?? null,
    ftp: Number.isFinite(ftp) && ftp > 0 ? ftp : null,
    tz_offset_min: Number.isInteger(tz) && tz >= -720 && tz <= 840 ? tz : null,
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

  const sessionId = createSession(req.user.id, req.body);
  const row = selectSessionById.get(sessionId, req.user.id);
  res.status(201).json(row);
});

// The Chronicle: every Push, newest first.
router.get('/', (req, res) => {
  res.json(selectAllSessions.all(req.user.id));
});

// One session with its full time series, for the ride chart.
router.get('/:id', (req, res) => {
  const session = selectSessionById.get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  res.json({ ...session, samples: selectSamples.all(req.params.id) });
});

// The ride as a .tcx download, to upload to Strava by hand. The file name
// carries the date and the workout, so a folder of them stays readable.
router.get('/:id/tcx', (req, res) => {
  const session = selectSessionById.get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const local = new Date(Date.parse(session.started_at) + (session.tz_offset_min ?? 0) * 60_000).toISOString().slice(0, 10);
  const slug = String(session.workout_name ?? 'free-ride').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ride';
  // attachment() sets a type from the extension; ours goes after it.
  res.attachment(`sisyphus-${local}-${slug}.tcx`);
  res.type('application/vnd.garmin.tcx+xml');
  res.send(buildTcx(session, selectSamples.all(session.id)));
});

// The rider's title and description of the ride (asked for when it ends,
// to paste into Strava). Either or both; blank clears one.
const TEXT_LIMITS = { title: 200, description: 2000 };
const updateText = {
  title: db.prepare('UPDATE sessions SET title = ? WHERE id = ? AND user_id = ?'),
  description: db.prepare('UPDATE sessions SET description = ? WHERE id = ? AND user_id = ?'),
};
const applyText = db.transaction((id, userId, fields) => {
  let changed = 0;
  for (const [field, value] of fields) changed += updateText[field].run(value.trim() || null, id, userId).changes;
  return changed;
});
router.patch('/:id', (req, res) => {
  const fields = Object.keys(TEXT_LIMITS).filter((f) => req.body?.[f] !== undefined).map((f) => [f, req.body[f]]);
  if (fields.length === 0) return res.status(400).json({ error: 'send a title or a description' });
  for (const [field, value] of fields) {
    if (typeof value !== 'string' || value.length > TEXT_LIMITS[field]) {
      return res.status(400).json({ error: `${field} must be text of at most ${TEXT_LIMITS[field]} characters` });
    }
  }
  if (!applyText(req.params.id, req.user.id, fields)) return res.status(404).json({ error: 'session not found' });
  res.json(selectSessionById.get(req.params.id, req.user.id));
});

// Deleting a Push removes its samples too — the log is the source of truth,
// so a mis-recorded ride has to be removable.
const deleteSamples = db.prepare('DELETE FROM session_samples WHERE session_id = ?');
const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
const removeSession = db.transaction((id, userId) => {
  if (!selectSessionById.get(id, userId)) return 0;
  deleteSamples.run(id);
  return deleteSession.run(id).changes;
});

router.delete('/:id', (req, res) => {
  const removed = removeSession(req.params.id, req.user.id);
  if (!removed) return res.status(404).json({ error: 'session not found' });
  res.status(204).end();
});

export default router;
