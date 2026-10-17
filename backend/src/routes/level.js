import { Router } from 'express';
import db from '../db/index.js';
import { xpFor, levelFromXp, thresholdFor } from '../level.js';

const router = Router();

// Only the sessions table — no sample scanning — so the header can ask for
// this on every page load without cost.
const selectTotals = db.prepare(
  `SELECT COUNT(*) AS pushes,
          COALESCE(SUM(distance_m), 0) AS distance_m,
          COALESCE(SUM((julianday(ended_at) - julianday(started_at)) * 24 * 60), 0) AS minutes
   FROM sessions
   WHERE user_id = ? AND ended_at IS NOT NULL AND started_at IS NOT NULL`
);

router.get('/', (req, res) => {
  const totals = selectTotals.get(req.user.id);
  const minutes = Math.max(0, totals.minutes ?? 0);
  const km = Math.max(0, (totals.distance_m ?? 0) / 1000);
  const pushes = totals.pushes ?? 0;

  const xp = xpFor({ minutes, km, pushes });
  const level = levelFromXp(xp);
  const currentFloor = thresholdFor(level);
  const nextFloor = thresholdFor(level + 1);

  res.json({
    level,
    xp,
    into_level: xp - currentFloor,
    needed_for_next: nextFloor - currentFloor,
    progress: Number(((xp - currentFloor) / (nextFloor - currentFloor)).toFixed(4)),
    totals: { pushes, minutes: Math.round(minutes), distance_km: Number(km.toFixed(2)) },
  });
});

export default router;
