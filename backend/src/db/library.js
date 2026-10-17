import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateStructure } from '../workout-structure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built-in workout library. library.json is the source of truth, reviewed
// in git like any other code; on every start it is mirrored into the
// workouts table as shared rows (user_id NULL, library_key set). Rows rather
// than serving the JSON directly, because a ride points at its workout by
// id: the Chronicle's target overlay, starring and "ride it" then work the
// same for a library workout as for a rider's own.
export function loadLibrary() {
  const entries = JSON.parse(readFileSync(path.join(__dirname, 'library.json'), 'utf8'));
  const seen = new Set();
  for (const entry of entries) {
    if (typeof entry.key !== 'string' || !entry.key || seen.has(entry.key)) {
      throw new Error(`library.json: missing or duplicate key "${entry.key}"`);
    }
    seen.add(entry.key);
    const error = validateStructure(entry.structure);
    if (error) throw new Error(`library.json: ${entry.key}: ${error}`);
    if (entry.test !== undefined) {
      const { kind, window_sec, factor } = entry.test;
      if (kind !== 'ftp' || !Number.isInteger(window_sec) || window_sec <= 0 || !(factor > 0 && factor <= 1)) {
        throw new Error(`library.json: ${entry.key}: test must be {kind:"ftp", window_sec>0, 0<factor<=1}`);
      }
      const total = entry.structure.reduce((sum, s) => sum + s.duration_sec, 0);
      if (total < window_sec) throw new Error(`library.json: ${entry.key}: shorter than its test window`);
    }
  }
  return entries;
}

export function syncLibrary(db, entries = loadLibrary()) {
  const existing = new Map(
    db.prepare('SELECT id, library_key, name, structure, test FROM workouts WHERE library_key IS NOT NULL')
      .all()
      .map((row) => [row.library_key, row])
  );
  const insert = db.prepare(
    'INSERT INTO workouts (name, structure, user_id, library_key, test) VALUES (?, ?, NULL, ?, ?)'
  );
  const update = db.prepare('UPDATE workouts SET name = ?, structure = ?, test = ? WHERE id = ?');

  db.transaction(() => {
    for (const entry of entries) {
      const structure = JSON.stringify(entry.structure);
      const test = entry.test ? JSON.stringify(entry.test) : null;
      const row = existing.get(entry.key);
      if (!row) insert.run(entry.name, structure, entry.key, test);
      else if (row.name !== entry.name || row.structure !== structure || row.test !== test) {
        update.run(entry.name, structure, test, row.id);
      }
      existing.delete(entry.key);
    }
    // Whatever is left was removed from the JSON. Retire it the same way a
    // rider's own workout is deleted: rides keep their snapshot of the name,
    // only the reference goes.
    for (const row of existing.values()) {
      db.prepare('UPDATE sessions SET workout_id = NULL WHERE workout_id = ?').run(row.id);
      db.prepare('DELETE FROM workout_stars WHERE workout_id = ?').run(row.id);
      db.prepare('DELETE FROM workouts WHERE id = ?').run(row.id);
    }
  })();
}
