import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { addClientLogs, queryClientLogs } from '../client-logs.js';

// /api/logs: a rider's browser sends its new log lines here (js/log.js).
const router = Router();

router.post('/', (req, res) => {
  const kept = addClientLogs(req.user.id, req.body?.entries, req.get('user-agent') ?? null);
  res.json({ kept });
});

export default router;

// GET /api/admin/logs with `Authorization: Bearer <LOGS_TOKEN>`: the riders'
// logs without a login, for reading them from a script. Read-only, this one
// route; the token is set in .env (32+ characters, or the route stays off).
// Without the header the request goes on to the normal admin login check;
// with a wrong one it stops here.
export const MIN_TOKEN_LENGTH = 32;
const digest = (s) => createHash('sha256').update(s).digest();

export function logsWithToken(token) {
  const expected = token && token.length >= MIN_TOKEN_LENGTH ? digest(token) : null;
  return (req, res, next) => {
    const header = req.get('authorization') ?? '';
    if (!header.startsWith('Bearer ')) return next();
    if (!expected || !timingSafeEqual(digest(header.slice(7)), expected)) {
      return res.status(401).json({ error: 'bad token' });
    }
    const { user, level, since, limit } = req.query;
    if (since && Number.isNaN(Date.parse(since))) return res.status(400).json({ error: 'since must be a date' });
    res.set('Cache-Control', 'no-store');
    res.json(queryClientLogs({ user, level, since, limit }));
  };
}
