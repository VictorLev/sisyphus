import { Router } from 'express';
import db from '../db/index.js';
import { findUserById } from '../auth/users.js';
import { readConfig } from './config.js';
import { levelFor } from './level.js';
import { featsFor } from './records.js';
import { badgesFor } from './badges.js';
import { cosmeticsOf } from './shop.js';

// /api/riders/:id: a rider's profile card, opened from the Leaderboard.
// What any rider may see of another: name, FTP, level and XP, badges
// earned, feats, the last five rides (name, date, time, distance, power),
// the avatar and what Sisyphus wears. Never their username, settings,
// samples or ride ids.

const RECENT = 5;
const selectRecent = db.prepare(
  `SELECT workout_name, route_id, started_at, ended_at, distance_m, avg_power
   FROM sessions WHERE user_id = ? AND ended_at IS NOT NULL
   ORDER BY started_at DESC LIMIT ?`
);

const router = Router();

router.get('/:id', (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'no such rider' });
  const worn = cosmeticsOf(user.id);
  const badges = badgesFor(user.id);
  res.json({
    name: user.display_name,
    you: user.id === req.user.id,
    ftp: readConfig(user.id, 'profile').ftp ?? null,
    level: levelFor(user.id),
    badges: { earned: badges.filter((b) => b.earned).length, total: badges.length },
    feats: featsFor(user.id).records.map(({ session_id: _id, ...feat }) => feat),
    recent: selectRecent.all(user.id, RECENT).map((s) => ({
      name: s.workout_name,
      route: s.route_id != null,
      started_at: s.started_at,
      minutes: Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000),
      distance_km: Number(((s.distance_m ?? 0) / 1000).toFixed(1)),
      avg_power: s.avg_power != null ? Math.round(s.avg_power) : null,
    })),
    avatar: { bg: worn.avatar_bg, emblem: worn.avatar_emblem, border: worn.avatar_border },
    costume: { hat: worn.hat, boulder: worn.boulder },
  });
});

export default router;
