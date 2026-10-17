import { randomBytes, createHash } from 'node:crypto';
import db from '../db/index.js';

export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// A session is pushed back out to the full 30 days once it is half used, so
// a rider who comes back weekly is never logged out, while one who stops
// riding is logged out a month after their last visit.
const RENEW_AFTER_MS = (SESSION_DAYS / 2) * DAY_MS;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const insertSession = db.prepare(
  'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
);
const selectSession = db.prepare(
  `SELECT a.expires_at, u.*
   FROM auth_sessions a JOIN users u ON u.id = a.user_id
   WHERE a.token_hash = ?`
);
const extendSession = db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?');
const deleteSession = db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?');
const deleteOthers = db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?');
const deleteAll = db.prepare('DELETE FROM auth_sessions WHERE user_id = ?');
const deleteExpired = db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?');

const expiryFrom = (now) => new Date(now + SESSION_DAYS * DAY_MS).toISOString();

export function startSession(userId, now = Date.now()) {
  deleteExpired.run(new Date(now).toISOString());
  const token = randomBytes(32).toString('base64url');
  const expiresAt = expiryFrom(now);
  insertSession.run(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

// The user behind a token, or null. `renewed` carries a new expiry when the
// session was extended, so the caller can refresh the cookie to match.
export function resolveSession(token, now = Date.now()) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = selectSession.get(tokenHash);
  if (!row) return null;

  const expiresMs = Date.parse(row.expires_at);
  if (!(expiresMs > now)) {
    deleteSession.run(tokenHash);
    return null;
  }
  const { expires_at, ...user } = row;
  let renewed = null;
  if (expiresMs - now < SESSION_DAYS * DAY_MS - RENEW_AFTER_MS) {
    renewed = expiryFrom(now);
    extendSession.run(renewed, tokenHash);
  }
  return { user, expiresAt: renewed ?? expires_at, renewed };
}

export function endSession(token) {
  if (token) deleteSession.run(hashToken(token));
}

export function endOtherSessions(userId, keepToken) {
  deleteOthers.run(userId, hashToken(keepToken));
}

export function endAllSessions(userId) {
  deleteAll.run(userId);
}
