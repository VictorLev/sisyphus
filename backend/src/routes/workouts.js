import { Router } from 'express';
import db from '../db/index.js';
import { validateStructure, toPercentOfFtp } from '../workout-structure.js';
import { readConfig } from './config.js';

const router = Router();

// A rider sees their own workouts plus the shared library. Everything else
// answers 404, exactly like an id that does not exist, so one rider cannot
// even learn that another's workout is there.
const VISIBLE = '(w.user_id = @userId OR w.library_key IS NOT NULL)';

const selectAllWorkouts = db.prepare(
  `SELECT w.*, (st.workout_id IS NOT NULL) AS is_starred
   FROM workouts w
   LEFT JOIN workout_stars st ON st.workout_id = w.id AND st.user_id = @userId
   WHERE ${VISIBLE}
   ORDER BY is_starred DESC,
            w.library_key IS NOT NULL,
            CASE WHEN w.library_key IS NOT NULL THEN w.id END,
            w.created_at DESC, w.id DESC`
);
const selectVisibleById = db.prepare(
  `SELECT w.*, (st.workout_id IS NOT NULL) AS is_starred
   FROM workouts w
   LEFT JOIN workout_stars st ON st.workout_id = w.id AND st.user_id = @userId
   WHERE w.id = @id AND ${VISIBLE}`
);
const insertWorkout = db.prepare(
  'INSERT INTO workouts (name, structure, user_id) VALUES (@name, @structure, @userId)'
);
const addStar = db.prepare('INSERT OR IGNORE INTO workout_stars (user_id, workout_id) VALUES (?, ?)');
const removeStar = db.prepare('DELETE FROM workout_stars WHERE user_id = ? AND workout_id = ?');

function toResponse(row) {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    structure: JSON.parse(row.structure),
    starred: !!row.is_starred,
    // Library workouts are shared and read-only; the client offers "Copy to
    // my workouts" instead of Edit and Delete.
    library: row.library_key != null,
    // Set on FTP tests: a ride on this workout yields an FTP estimate.
    test: row.test ? JSON.parse(row.test) : null,
  };
}

const findVisible = (req) => selectVisibleById.get({ id: req.params.id, userId: req.user.id });

// The workout if the rider may change it. Otherwise sends the error and
// returns null: 403 for the library (visible, but read-only), 404 for
// anything not theirs.
function findEditable(req, res) {
  const row = findVisible(req);
  if (!row) {
    res.status(404).json({ error: 'workout not found' });
    return null;
  }
  if (row.library_key != null) {
    res.status(403).json({ error: 'Library workouts are read-only. Copy it to your workouts to change it.' });
    return null;
  }
  return row;
}

function validateBody(body) {
  const { name, structure } = body ?? {};
  if (typeof name !== 'string' || name.trim() === '') return 'name must be a non-empty string';
  return validateStructure(structure);
}

router.post('/', (req, res) => {
  const error = validateBody(req.body);
  if (error) return res.status(400).json({ error });

  const { name } = req.body;
  const structure = toPercentOfFtp(req.body.structure, readConfig(req.user.id, 'profile').ftp);
  const info = insertWorkout.run({ name, structure: JSON.stringify(structure), userId: req.user.id });
  res.status(201).json(toResponse(selectVisibleById.get({ id: info.lastInsertRowid, userId: req.user.id })));
});

router.get('/', (req, res) => {
  res.json(selectAllWorkouts.all({ userId: req.user.id }).map(toResponse));
});

router.get('/:id', (req, res) => {
  const row = findVisible(req);
  if (!row) return res.status(404).json({ error: 'workout not found' });
  res.json(toResponse(row));
});

// Editing replaces name and structure wholesale — the builder always sends
// the complete workout, so a partial merge would be misleading.
const updateWorkout = db.prepare(
  'UPDATE workouts SET name = @name, structure = @structure WHERE id = @id AND user_id = @userId'
);

router.put('/:id', (req, res) => {
  if (!findEditable(req, res)) return;
  const error = validateBody(req.body);
  if (error) return res.status(400).json({ error });

  const { name } = req.body;
  const structure = toPercentOfFtp(req.body.structure, readConfig(req.user.id, 'profile').ftp);
  updateWorkout.run({ id: req.params.id, userId: req.user.id, name, structure: JSON.stringify(structure) });
  res.json(toResponse(findVisible(req)));
});

// "Copy to my workouts": the rider's own editable version, in % of FTP like
// the original, so it keeps scaling with the rider. A copy of an FTP test is
// an ordinary workout: it is the test's `test` marker that makes a ride
// yield an FTP estimate, and the copy doesn't carry it.
router.post('/:id/copy', (req, res) => {
  const row = findVisible(req);
  if (!row) return res.status(404).json({ error: 'workout not found' });

  const structure = toPercentOfFtp(JSON.parse(row.structure), readConfig(req.user.id, 'profile').ftp);
  const info = insertWorkout.run({ name: row.name, structure: JSON.stringify(structure), userId: req.user.id });
  res.status(201).json(toResponse(selectVisibleById.get({ id: info.lastInsertRowid, userId: req.user.id })));
});

// Starring is its own endpoint: it is a one-field toggle from a list row,
// not a full workout edit. Stars are per rider, so library workouts can be
// starred too.
router.patch('/:id/starred', (req, res) => {
  const row = findVisible(req);
  if (!row) return res.status(404).json({ error: 'workout not found' });
  if (typeof req.body?.starred !== 'boolean') {
    return res.status(400).json({ error: 'starred must be a boolean' });
  }
  if (req.body.starred) addStar.run(req.user.id, row.id);
  else removeStar.run(req.user.id, row.id);
  res.json(toResponse(findVisible(req)));
});

const countSessions = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE workout_id = ? AND user_id = ?');
const deleteWorkout = db.transaction((id, userId) => {
  // Past rides keep their own copy of the name (sessions.workout_name), so
  // deleting a template never rewrites history — the reference is simply
  // cleared and the Chronicle still shows what was ridden.
  db.prepare('UPDATE sessions SET workout_id = NULL WHERE workout_id = ?').run(id);
  db.prepare('DELETE FROM workout_stars WHERE workout_id = ?').run(id);
  db.prepare('DELETE FROM workouts WHERE id = ? AND user_id = ?').run(id, userId);
});

router.delete('/:id', (req, res) => {
  const row = findEditable(req, res);
  if (!row) return;
  const rides = countSessions.get(row.id, req.user.id).n;
  deleteWorkout(row.id, req.user.id);
  res.json({ deleted: true, rides_kept: rides });
});

export default router;
