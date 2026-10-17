import { Router } from 'express';
import db from '../db/index.js';
import { bestAverage } from '../power.js';

const router = Router();

// Durations for the power curve, in seconds.
const POWER_WINDOWS = [5, 60, 300, 1200];

const selectSessions = db.prepare(
  `SELECT s.*, COALESCE(s.workout_name, w.name) AS workout_name
   FROM sessions s LEFT JOIN workouts w ON w.id = s.workout_id
   WHERE s.user_id = ?`
);
const selectSamples = db.prepare(
  'SELECT timestamp_offset_sec, power FROM session_samples WHERE session_id = ? ORDER BY timestamp_offset_sec'
);

function durationSec(session) {
  const ms = new Date(session.ended_at) - new Date(session.started_at);
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
}

function best(list, valueOf) {
  let winner = null;
  for (const item of list) {
    const value = valueOf(item);
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    if (winner === null || value > winner.value) winner = { value, session: item };
  }
  return winner;
}

function entry(key, label, unit, winner, format) {
  if (!winner) return { key, label, unit, value: null };
  return {
    key,
    label,
    unit,
    value: winner.value,
    display: format(winner.value),
    session_id: winner.session.id,
    session_name: winner.session.workout_name || 'Free Ride',
    achieved_at: winner.session.started_at,
  };
}

// Feats are each rider's own: only their rides are scanned.
router.get('/', (req, res) => {
  const sessions = selectSessions.all(req.user.id);

  const totals = sessions.reduce(
    (acc, s) => ({
      pushes: acc.pushes + 1,
      seconds: acc.seconds + durationSec(s),
      distance: acc.distance + (s.distance_m ?? 0),
    }),
    { pushes: 0, seconds: 0, distance: 0 }
  );

  const records = [
    entry('longest_ride', 'Longest Push', 'time', best(sessions, durationSec), (v) => {
      const m = Math.round(v / 60);
      return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
    }),
    entry('furthest_ride', 'Furthest Push', 'km', best(sessions, (s) => s.distance_m), (v) => `${(v / 1000).toFixed(2)} km`),
    entry('highest_avg_power', 'Highest Avg Power', 'W', best(sessions, (s) => s.avg_power), (v) => `${Math.round(v)} W`),
    entry('peak_power', 'Peak Power', 'W', best(sessions, (s) => s.max_power), (v) => `${Math.round(v)} W`),
  ];

  // The power curve needs each ride's time series; a personal log is small
  // enough to scan on demand, which keeps records always-fresh with no
  // cache to invalidate when a ride is deleted.
  for (const windowSec of POWER_WINDOWS) {
    const winner = best(sessions, (s) => bestAverage(selectSamples.all(s.id), windowSec));
    const label = windowSec < 60 ? `Best ${windowSec}s Power` : `Best ${windowSec / 60}-min Power`;
    records.push(entry(`best_${windowSec}s`, label, 'W', winner, (v) => `${Math.round(v)} W`));
  }

  res.json({
    totals: {
      pushes: totals.pushes,
      minutes: Math.round(totals.seconds / 60),
      distance_km: Number((totals.distance / 1000).toFixed(2)),
    },
    records,
  });
});

export default router;
