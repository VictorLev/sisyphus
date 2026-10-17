import { Router } from 'express';
import db from '../db/index.js';
import { computeBadges } from '../badges.js';
import { bestAverage } from '../power.js';
import { readConfig } from './config.js';

const router = Router();

const selectSessions = db.prepare(
  `SELECT id, workout_id, workout_name, started_at, ended_at, distance_m, max_power, avg_cadence, ftp, tz_offset_min
   FROM sessions WHERE user_id = ?`
);
// Coasting is read from the share of samples at zero cadence: one grouped
// query instead of loading every sample.
const selectSampleStats = db.prepare(
  `SELECT ss.session_id, COUNT(*) AS count, SUM(CASE WHEN ss.cadence = 0 THEN 1 ELSE 0 END) AS zero
   FROM session_samples ss JOIN sessions s ON s.id = ss.session_id
   WHERE s.user_id = ? GROUP BY ss.session_id`
);
const selectPowerSamples = db.prepare(
  'SELECT timestamp_offset_sec, power FROM session_samples WHERE session_id = ? ORDER BY timestamp_offset_sec'
);
const selectWorkouts = db.prepare(
  `SELECT id, structure, library_key, test FROM workouts WHERE user_id = ? OR library_key IS NOT NULL`
);
const selectFtpHistory = db.prepare(
  'SELECT ftp, previous_ftp, source, session_id, created_at FROM ftp_history WHERE user_id = ? ORDER BY id'
);

router.get('/', (req, res) => {
  const userId = req.user.id;
  const sessions = selectSessions.all(userId);

  const sampleStats = {};
  for (const row of selectSampleStats.all(userId)) sampleStats[row.session_id] = row;

  // Best 20 minutes, only for rides long enough to have one.
  const best20 = {};
  for (const s of sessions) {
    if (Date.parse(s.ended_at) - Date.parse(s.started_at) >= 1200 * 1000) {
      best20[s.id] = bestAverage(selectPowerSamples.all(s.id), 1200);
    }
  }

  const workouts = selectWorkouts.all(userId).map((w) => ({
    id: w.id,
    library: w.library_key != null,
    test: w.test != null,
    totalSec: JSON.parse(w.structure).reduce((sum, seg) => sum + seg.duration_sec, 0),
  }));

  const badges = computeBadges({
    sessions,
    sampleStats,
    best20,
    workouts,
    ftpHistory: selectFtpHistory.all(userId),
    currentFtp: readConfig(userId, 'profile').ftp,
  });
  res.json({
    earned: badges.filter((b) => b.earned).length,
    total: badges.length,
    badges,
  });
});

export default router;
