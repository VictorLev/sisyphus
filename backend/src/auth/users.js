import db from '../db/index.js';
import { hashPassword, minPasswordLength, passwordLengthError } from './password.js';
import { USERNAME_PATTERN, claimOrphans } from '../db/migrate.js';

const selectByUsername = db.prepare('SELECT * FROM users WHERE username = ?'); // column is NOCASE
const selectById = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)'
);
const updateHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

// What the API and the frontend see of an account. Never the hash.
export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    is_admin: !!user.is_admin,
  };
}

export function findUserByUsername(username) {
  return selectByUsername.get(String(username).trim());
}

export function findUserById(id) {
  return selectById.get(id);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < minPasswordLength()) {
    return passwordLengthError();
  }
  if (password.length > 200) return 'password is too long';
  return null;
}

export async function createUser({ username, password, displayName, isAdmin = false }) {
  const name = String(username ?? '').trim();
  if (!USERNAME_PATTERN.test(name)) {
    throw new Error('username must be 2-32 letters, digits, dots, dashes or underscores');
  }
  const invalid = validatePassword(password);
  if (invalid) throw new Error(invalid);
  if (findUserByUsername(name)) throw new Error(`user "${name}" already exists`);

  const info = insertUser.run(name, await hashPassword(password), displayName?.trim() || name, isAdmin ? 1 : 0);
  // The first admin inherits any history from before accounts existed.
  if (isAdmin) claimOrphans(db);
  return findUserById(info.lastInsertRowid);
}

export async function setPassword(userId, password) {
  const invalid = validatePassword(password);
  if (invalid) throw new Error(invalid);
  updateHash.run(await hashPassword(password), userId);
}

// What deleting a rider removes, per table. Used for the dry run and the
// real thing, so the preview always matches what happens.
const OWNED = [
  ['rides', 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?'],
  ['ride samples', 'SELECT COUNT(*) AS n FROM session_samples WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)'],
  ['workouts', 'SELECT COUNT(*) AS n FROM workouts WHERE user_id = ?'],
  ['stars', 'SELECT COUNT(*) AS n FROM workout_stars WHERE user_id = ?'],
  ['FTP history entries', 'SELECT COUNT(*) AS n FROM ftp_history WHERE user_id = ?'],
  ['settings', 'SELECT COUNT(*) AS n FROM user_config WHERE user_id = ?'],
  ['logins', 'SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?'],
];

export function countUserData(userId) {
  return Object.fromEntries(OWNED.map(([label, sql]) => [label, db.prepare(sql).get(userId).n]));
}

// Deletes an account and everything that belongs to it, in one
// transaction. Refuses the last admin, so nobody can lock themselves out.
// Other riders are untouched: nobody else can reference this rider's rides
// or workouts (they are private), and library workouts are never theirs.
export function deleteUser(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('no such user');
  if (user.is_admin) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get();
    if (n <= 1) throw new Error(`"${user.username}" is the only admin; make another admin first`);
  }
  const removed = countUserData(userId);
  db.transaction(() => {
    db.prepare('DELETE FROM session_samples WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM records WHERE user_id = ? OR session_id IN (SELECT id FROM sessions WHERE user_id = ?)').run(userId, userId);
    db.prepare('DELETE FROM ftp_history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM workout_stars WHERE user_id = ? OR workout_id IN (SELECT id FROM workouts WHERE user_id = ?)').run(userId, userId);
    db.prepare('DELETE FROM workouts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_config WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  })();
  return removed;
}
