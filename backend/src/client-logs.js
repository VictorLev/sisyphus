import db from './db/index.js';

// Riders' browser logs, kept on the server (POST /api/logs) for the Admin
// Panel and `npm run logs`. Everything Bluetooth happens in the browser, so
// this is the only way to see a trainer fail on someone else's machine.

export const LEVELS = ['info', 'warn', 'error'];
export const MAX_BATCH = 200; // the browser keeps at most 200 lines itself
const MAX_MESSAGE = 1000;
const KEEP_DAYS = 30;

const insert = db.prepare(
  'INSERT INTO client_logs (user_id, at, level, message, user_agent) VALUES (?, ?, ?, ?, ?)'
);
const prune = db.prepare("DELETE FROM client_logs WHERE received_at < datetime('now', ?)");

// Stores what a browser sent; returns how many lines were kept. Lines that
// aren't { at, level, message } are dropped rather than refusing the batch.
export function addClientLogs(userId, entries, userAgent = null) {
  const valid = (Array.isArray(entries) ? entries : []).slice(-MAX_BATCH).filter((e) =>
    e && LEVELS.includes(e.level) && typeof e.message === 'string' && !Number.isNaN(Date.parse(e.at)));
  db.transaction(() => {
    for (const e of valid) {
      insert.run(userId, new Date(e.at).toISOString(), e.level, e.message.slice(0, MAX_MESSAGE), userAgent?.slice(0, 300) ?? null);
    }
    prune.run(`-${KEEP_DAYS} days`);
  })();
  return valid.length;
}

// Newest first. Filters: rider (id or username), lowest level, since (ISO).
export function queryClientLogs({ user = null, level = 'info', since = null, limit = 300 } = {}) {
  const where = [];
  const args = [];
  if (user != null && user !== '') {
    where.push(/^\d+$/.test(String(user)) ? 'l.user_id = ?' : 'u.username = ?');
    args.push(user);
  }
  const levels = LEVELS.slice(Math.max(0, LEVELS.indexOf(level)));
  where.push(`l.level IN (${levels.map(() => '?').join(', ')})`);
  args.push(...levels);
  if (since) {
    where.push('l.at >= ?');
    args.push(new Date(since).toISOString());
  }
  return db.prepare(
    `SELECT l.id, l.at, l.level, l.message, l.user_agent, l.user_id, u.username, u.display_name
     FROM client_logs l JOIN users u ON u.id = l.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.at DESC, l.id DESC LIMIT ?`
  ).all(...args, Math.max(1, Math.min(5000, Number(limit) || 300)));
}
