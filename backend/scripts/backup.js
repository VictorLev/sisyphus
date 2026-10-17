// Takes a consistent copy of the database while the app keeps running.
//
//   node scripts/backup.js [--tag nightly] [--keep 14]
//
// Uses SQLite's online backup API (better-sqlite3's db.backup()), which is
// safe against a live writer, unlike copying the file, which can catch it
// half-written. Writes BACKUP_DIR/sisyphus-<tag>-<UTC timestamp>.db, checks
// the copy, then keeps only the newest --keep backups with that tag.
//
// Deliberately does NOT import src/db/index.js: that would run migrations,
// and deploy/update.sh runs this from the NEW image before restarting, so it
// must copy the database exactly as the old version left it.
//
// Exits non-zero on any failure, which is what makes update.sh stop.
import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const dbPath = process.env.DB_PATH || './data/sisyphus.db';
const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
const tag = option('tag', 'manual');
const keep = Number(option('keep', 14));

if (!/^[a-z0-9-]+$/.test(tag)) {
  console.error('--tag must be lowercase letters, digits and dashes');
  process.exit(2);
}
if (!Number.isInteger(keep) || keep < 1) {
  console.error('--keep must be a positive integer');
  process.exit(2);
}

if (!existsSync(dbPath)) {
  // A first deploy has no database yet; there is nothing to lose.
  console.log(`No database at ${dbPath}; nothing to back up.`);
  process.exit(0);
}

mkdirSync(backupDir, { recursive: true });
// Milliseconds included, so two backups in the same second cannot collide.
const stamp = new Date().toISOString().replace(/[-:]/g, '');
const finalPath = path.join(backupDir, `sisyphus-${tag}-${stamp}.db`);
// Written under a temporary name and renamed once verified, so a failed or
// interrupted backup can never be mistaken for a good one.
const partialPath = `${finalPath}.partial`;

try {
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(partialPath);
  } finally {
    source.close();
  }

  const copy = new Database(partialPath);
  try {
    // The copy inherits WAL mode; switch it to a plain rollback journal so
    // the backup is one self-contained file with no -wal/-shm beside it.
    copy.pragma('journal_mode = DELETE');
    const check = copy.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`backup failed its integrity check: ${check}`);
    const { n } = copy.prepare('SELECT COUNT(*) AS n FROM sessions').get();
    console.log(`Backed up ${n} rides to ${finalPath}`);
  } finally {
    copy.close();
  }
  renameSync(partialPath, finalPath);
} catch (err) {
  for (const leftover of ['', '-wal', '-shm', '-journal']) rmSync(partialPath + leftover, { force: true });
  console.error(`Backup FAILED: ${err.message}`);
  process.exit(1);
}

// Retention: the timestamp sorts lexically, so the newest are last.
const prefix = `sisyphus-${tag}-`;
const backups = readdirSync(backupDir).filter((f) => f.startsWith(prefix) && f.endsWith('.db')).sort();
for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
  rmSync(path.join(backupDir, old));
  console.log(`Removed old backup ${old}`);
}
