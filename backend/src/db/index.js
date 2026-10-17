import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate.js';

const dbPath = process.env.DB_PATH || './data/sisyphus.db';

// better-sqlite3 creates the file but not its folder, so a fresh clone (or an
// empty Docker volume) would crash on first run without this.
mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

migrate(db, process.env);

export default db;
