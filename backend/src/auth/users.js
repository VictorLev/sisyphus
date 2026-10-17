import db from '../db/index.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password.js';
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
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
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
