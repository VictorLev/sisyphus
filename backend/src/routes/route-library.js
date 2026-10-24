import { Router, raw } from 'express';
import { mkdirSync, openSync, writeSync, closeSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import { parseRouteFile, RouteFileError } from '../route-file.js';

// /api/routes: rides along a filmed road. Every rider sees and rides them;
// only an admin imports or deletes. An import is two steps:
//   POST /api/routes                     { name, route: <route file>, video_size }
//   PUT  /api/routes/:id/video?offset=N  the video, in pieces of up to 32 MB
// Pieces, because Cloudflare refuses a request over 100 MB and a 2 GB video
// can't go in one; they arrive in order, and a failed upload resumes from
// video_received. The video streams back with range requests, so the
// player can seek.

export const CHUNK_MAX = 32 * 1024 * 1024;

export function routesDir() {
  const dbPath = process.env.DB_PATH || './data/sisyphus.db';
  return process.env.ROUTES_DIR || path.join(path.dirname(dbPath), 'routes');
}
const videoPath = (id) => path.join(routesDir(), String(id), 'video.mp4');

const q = {
  list: db.prepare(
    `SELECT r.id, r.name, r.distance_m, r.ascent_m, r.duration_s, r.points, r.video_size, r.video_received, r.created_at,
            (s.user_id IS NOT NULL) AS starred
     FROM routes r LEFT JOIN route_stars s ON s.route_id = r.id AND s.user_id = ?
     ORDER BY r.name COLLATE NOCASE`
  ),
  get: db.prepare('SELECT * FROM routes WHERE id = ?'),
  isStarred: db.prepare('SELECT 1 FROM route_stars WHERE user_id = ? AND route_id = ?'),
  star: db.prepare('INSERT OR IGNORE INTO route_stars (user_id, route_id) VALUES (?, ?)'),
  unstar: db.prepare('DELETE FROM route_stars WHERE user_id = ? AND route_id = ?'),
  removeStars: db.prepare('DELETE FROM route_stars WHERE route_id = ?'),
  insert: db.prepare(
    `INSERT INTO routes (name, distance_m, ascent_m, duration_s, points, video_points, video_size, created_by)
     VALUES (@name, @distance_m, @ascent_m, @duration_s, @points, @video_points, @video_size, @created_by)`
  ),
  received: db.prepare('UPDATE routes SET video_received = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM routes WHERE id = ?'),
  rename: db.prepare('UPDATE routes SET name = ? WHERE id = ?'),
};

// A few dozen altitudes for the list's little elevation profile.
function preview(points, samples = 60) {
  const total = points.at(-1).d;
  const out = [];
  let j = 0;
  for (let i = 0; i < samples; i++) {
    const d = (total * i) / (samples - 1);
    while (j < points.length - 2 && points[j + 1].d < d) j++;
    const a = points[j];
    const b = points[j + 1];
    const f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    out.push(Math.round((a.alt + (b.alt - a.alt) * Math.max(0, Math.min(1, f))) * 10) / 10);
  }
  return out;
}

function summary(row, userId) {
  const starred = row.starred ?? (userId != null && Boolean(q.isStarred.get(userId, row.id)));
  return {
    id: row.id,
    name: row.name,
    distance_m: row.distance_m,
    ascent_m: row.ascent_m,
    duration_s: row.duration_s,
    ready: row.video_received >= row.video_size,
    starred: Boolean(starred),
    video_size: row.video_size,
    video_received: row.video_received,
    profile: preview(JSON.parse(row.points)),
  };
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'only an admin can change routes' });
  next();
}

const router = Router();

router.get('/', (req, res) => res.json(q.list.all(req.user.id).map((row) => summary(row, req.user.id))));

router.get('/:id', (req, res) => {
  const row = q.get.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'route not found' });
  res.json({ ...summary(row, req.user.id), points: JSON.parse(row.points), video_points: JSON.parse(row.video_points) });
});

// Stars are each rider's own, like workout stars.
router.patch('/:id/starred', (req, res) => {
  const row = q.get.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'route not found' });
  if (typeof req.body?.starred !== 'boolean') return res.status(400).json({ error: 'starred must be true or false' });
  (req.body.starred ? q.star : q.unstar).run(req.user.id, row.id);
  res.json(summary(row, req.user.id));
});

router.post('/', requireAdmin, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const size = Number(req.body?.video_size);
  if (!name || name.length > 120) return res.status(400).json({ error: 'name must be 1-120 characters' });
  if (!Number.isInteger(size) || size <= 0) return res.status(400).json({ error: 'video_size must be the video file size in bytes' });
  let parsed;
  try {
    parsed = parseRouteFile(req.body?.route);
  } catch (err) {
    if (err instanceof RouteFileError) return res.status(400).json({ error: err.message });
    throw err;
  }
  const id = q.insert.run({
    name,
    distance_m: parsed.distanceM,
    ascent_m: parsed.ascentM,
    duration_s: parsed.durationS,
    points: JSON.stringify(parsed.points),
    video_points: JSON.stringify(parsed.videoPoints),
    video_size: size,
    created_by: req.user.id,
  }).lastInsertRowid;
  mkdirSync(path.dirname(videoPath(id)), { recursive: true });
  res.status(201).json(summary(q.get.get(id), req.user.id));
});

router.patch('/:id', requireAdmin, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 120) return res.status(400).json({ error: 'name must be 1-120 characters' });
  if (!q.rename.run(name, req.params.id).changes) return res.status(404).json({ error: 'route not found' });
  res.json(summary(q.get.get(req.params.id), req.user.id));
});

// One piece of the video, written at ?offset=, which must be where the
// last piece ended (409 says where that is, to resume).
router.put('/:id/video', requireAdmin, raw({ type: '*/*', limit: CHUNK_MAX + 1024 }), (req, res) => {
  const row = q.get.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'route not found' });
  const offset = Number(req.query.offset);
  if (offset !== row.video_received) {
    return res.status(409).json({ error: `expected offset ${row.video_received}`, video_received: row.video_received });
  }
  const chunk = req.body;
  if (!Buffer.isBuffer(chunk) || chunk.length === 0) return res.status(400).json({ error: 'empty piece' });
  if (offset + chunk.length > row.video_size) return res.status(400).json({ error: 'more bytes than the video size given' });
  mkdirSync(path.dirname(videoPath(row.id)), { recursive: true });
  const fd = openSync(videoPath(row.id), offset === 0 ? 'w' : 'r+');
  try {
    writeSync(fd, chunk, 0, chunk.length, offset);
  } finally {
    closeSync(fd);
  }
  q.received.run(offset + chunk.length, row.id);
  res.json(summary(q.get.get(row.id), req.user.id));
});

// The video, for the player: sendFile answers range requests (206), so it
// can start anywhere and seek.
router.get('/:id/video', (req, res) => {
  const row = q.get.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'route not found' });
  if (row.video_received < row.video_size || !existsSync(videoPath(row.id))) {
    return res.status(409).json({ error: 'the video is not fully uploaded yet' });
  }
  res.sendFile(path.resolve(videoPath(row.id)), { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=86400' } });
});

// Rides on the route keep their route_id and name; only the route goes.
router.delete('/:id', requireAdmin, (req, res) => {
  q.removeStars.run(req.params.id);
  if (!q.remove.run(req.params.id).changes) return res.status(404).json({ error: 'route not found' });
  rmSync(path.join(routesDir(), String(Number(req.params.id))), { recursive: true, force: true });
  res.status(204).end();
});

export default router;
