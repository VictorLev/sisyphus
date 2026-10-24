import { Router } from 'express';
import db from '../db/index.js';
import { computeBadges } from '../badges.js';
import { bestAverage } from '../power.js';
import { readConfig } from './config.js';

const router = Router();

const selectSessions = db.prepare(
  `SELECT id, workout_id, workout_name, route_id, started_at, ended_at, distance_m, max_power, avg_power, avg_cadence, avg_speed, ftp, tz_offset_min
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
// Minutes per rider per calendar year, for the Champion badges. A ride counts
// for the year of its own local date (its saved UTC offset), so 23:30 on
// 31 December in Montréal belongs to that year.
const selectYearTotals = db.prepare(
  `SELECT user_id,
          CAST(strftime('%Y', started_at, printf('%+d minutes', COALESCE(tz_offset_min, 0))) AS INTEGER) AS year,
          SUM((julianday(ended_at) - julianday(started_at)) * 24 * 60) AS minutes
   FROM sessions WHERE ended_at IS NOT NULL
   GROUP BY user_id, year`
);
// The same per calendar month ("YYYY-MM"), for Employee of the Month.
const selectMonthTotals = db.prepare(
  `SELECT user_id,
          strftime('%Y-%m', started_at, printf('%+d minutes', COALESCE(tz_offset_min, 0))) AS month,
          SUM((julianday(ended_at) - julianday(started_at)) * 24 * 60) AS minutes
   FROM sessions WHERE ended_at IS NOT NULL
   GROUP BY user_id, month`
);
const selectRoutes = db.prepare('SELECT id, distance_m, ascent_m FROM routes WHERE video_received >= video_size');
const selectFtpHistory = db.prepare(
  'SELECT ftp, previous_ftp, source, session_id, created_at FROM ftp_history WHERE user_id = ? ORDER BY id'
);

function totalsFor(rows, key, userId) {
  const totals = {};
  for (const row of rows) {
    const entry = (totals[row[key]] ??= { mine: 0, best: 0 });
    entry.best = Math.max(entry.best, row.minutes);
    if (row.user_id === userId) entry.mine = row.minutes;
  }
  return totals;
}
const yearTotalsFor = (userId) => totalsFor(selectYearTotals.all(), 'year', userId);
const monthTotalsFor = (userId) => totalsFor(selectMonthTotals.all(), 'month', userId);

// Every badge for a rider, earned or not (also the shop's drachma rewards).
export function badgesFor(userId) {
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

  return computeBadges({
    sessions,
    sampleStats,
    best20,
    workouts,
    ftpHistory: selectFtpHistory.all(userId),
    currentFtp: readConfig(userId, 'profile').ftp,
    yearTotals: yearTotalsFor(userId),
    monthTotals: monthTotalsFor(userId),
    routes: selectRoutes.all(),
  });
}

router.get('/', (req, res) => {
  const badges = badgesFor(req.user.id);
  res.json({
    earned: badges.filter((b) => b.earned).length,
    total: badges.length,
    badges,
  });
});

export default router;
