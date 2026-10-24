import { Router } from 'express';
import db from '../db/index.js';
import { periodRange } from '../periods.js';
import { xpFor, levelFromXp } from '../level.js';
import { cosmeticsOf } from './shop.js';

const router = Router();

// Every rider who rode in the period, with their totals and their all-time
// level. Riders with no rides in it aren't listed at all. Only the display
// name and these numbers leave the server; never usernames or anything
// from another rider's log.
const selectPeriod = db.prepare(
  `SELECT u.id, u.display_name,
          COUNT(s.id) AS rides,
          COALESCE(SUM((julianday(s.ended_at) - julianday(s.started_at)) * 24 * 60), 0) AS minutes,
          COALESCE(SUM(s.distance_m), 0) AS distance_m
   FROM users u
   LEFT JOIN sessions s ON s.user_id = u.id
     AND s.ended_at IS NOT NULL
     AND julianday(s.started_at) >= julianday(@from)
     AND julianday(s.started_at) < julianday(@to)
   GROUP BY u.id
   HAVING COUNT(s.id) > 0`
);
const selectAllTime = db.prepare(
  `SELECT user_id, COUNT(*) AS pushes,
          COALESCE(SUM(distance_m), 0) AS distance_m,
          COALESCE(SUM((julianday(ended_at) - julianday(started_at)) * 24 * 60), 0) AS minutes
   FROM sessions WHERE ended_at IS NOT NULL GROUP BY user_id`
);

router.get('/', (req, res) => {
  const period = ['month', 'year'].includes(req.query.period) ? req.query.period : 'week';
  const tz = Number(req.query.tz);
  const tzOffsetMin = Number.isInteger(tz) && tz >= -720 && tz <= 840 ? tz : 0;
  const { from, to } = periodRange(period, tzOffsetMin);

  const allTime = new Map(selectAllTime.all().map((r) => [r.user_id, r]));
  const riders = selectPeriod.all({ from, to }).map((r) => {
    const total = allTime.get(r.id);
    const level = levelFromXp(total
      ? xpFor({ minutes: total.minutes, km: total.distance_m / 1000, pushes: total.pushes })
      : 0);
    return {
      name: r.display_name,
      you: r.id === req.user.id,
      level,
      rides: r.rides,
      minutes: Math.max(0, Math.round(r.minutes)),
      distance_km: Number((Math.max(0, r.distance_m) / 1000).toFixed(1)),
      // The avatar they bought: background and emblem ids, or null.
      avatar: (({ avatar_bg: bg, avatar_emblem: emblem }) => ({ bg, emblem }))(cosmeticsOf(r.id)),
    };
  });
  res.json({ period, from, to, riders });
});

export default router;
