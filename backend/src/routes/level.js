import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// XP is deliberately built from stable quantities — time and distance
// ridden — rather than training load. Load depends on FTP, so raising your
// FTP would retroactively shrink past rides and your level could go DOWN,
// which is the one thing a progression system must never do.
const XP_PER_MINUTE = 1;
const XP_PER_KM = 1;
const XP_PER_PUSH = 10; // finishing a ride at all is the point

// Cumulative XP required to reach a level: 100, 300, 600, 1000, 1500...
// Early levels arrive within a ride or two, later ones take real volume.
const thresholdFor = (level) => (100 * (level - 1) * level) / 2;

function levelFromXp(xp) {
  let level = 1;
  while (thresholdFor(level + 1) <= xp) level += 1;
  return level;
}

// Only the sessions table — no sample scanning — so the header can ask for
// this on every page load without cost.
const selectTotals = db.prepare(
  `SELECT COUNT(*) AS pushes,
          COALESCE(SUM(distance_m), 0) AS distance_m,
          COALESCE(SUM((julianday(ended_at) - julianday(started_at)) * 24 * 60), 0) AS minutes
   FROM sessions
   WHERE ended_at IS NOT NULL AND started_at IS NOT NULL`
);

router.get('/', (req, res) => {
  const totals = selectTotals.get();
  const minutes = Math.max(0, totals.minutes ?? 0);
  const km = Math.max(0, (totals.distance_m ?? 0) / 1000);
  const pushes = totals.pushes ?? 0;

  const xp = Math.round(minutes * XP_PER_MINUTE + km * XP_PER_KM + pushes * XP_PER_PUSH);
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
