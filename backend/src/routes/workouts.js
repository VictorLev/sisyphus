import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

const insertWorkout = db.prepare(
  'INSERT INTO workouts (name, structure) VALUES (@name, @structure)'
);
const selectAllWorkouts = db.prepare(
  'SELECT * FROM workouts ORDER BY created_at DESC'
);
const selectWorkoutById = db.prepare('SELECT * FROM workouts WHERE id = ?');

function toResponse(row) {
  return { ...row, structure: JSON.parse(row.structure) };
}

function validateStructure(structure) {
  if (!Array.isArray(structure) || structure.length === 0) {
    return 'structure must be a non-empty array';
  }
  for (const segment of structure) {
    if (
      typeof segment !== 'object' ||
      segment === null ||
      !Number.isInteger(segment.duration_sec) ||
      segment.duration_sec <= 0 ||
      typeof segment.target_watts !== 'number' ||
      segment.target_watts < 0 ||
      typeof segment.label !== 'string'
    ) {
      return 'each segment requires integer duration_sec > 0, numeric target_watts >= 0, and a string label';
    }
    // Optional terrain. Signed: positive climbs, negative descends. Older
    // workouts have no grade at all, which reads as flat.
    if (segment.grade_percent !== undefined) {
      if (typeof segment.grade_percent !== 'number' || !Number.isFinite(segment.grade_percent)) {
        return 'grade_percent must be a number';
      }
      if (segment.grade_percent < -20 || segment.grade_percent > 20) {
        return 'grade_percent must be between -20 and 20';
      }
    }
  }
  return null;
}

router.post('/', (req, res) => {
  const { name, structure } = req.body;

  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }

  const structureError = validateStructure(structure);
  if (structureError) {
    return res.status(400).json({ error: structureError });
  }

  const info = insertWorkout.run({ name, structure: JSON.stringify(structure) });
  const row = selectWorkoutById.get(info.lastInsertRowid);
  res.status(201).json(toResponse(row));
});

router.get('/', (req, res) => {
  const rows = selectAllWorkouts.all();
  res.json(rows.map(toResponse));
});

router.get('/:id', (req, res) => {
  const row = selectWorkoutById.get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'workout not found' });
  }
  res.json(toResponse(row));
});

// Editing replaces name and structure wholesale — the builder always sends
// the complete workout, so a partial merge would be misleading.
const updateWorkout = db.prepare(
  'UPDATE workouts SET name = @name, structure = @structure WHERE id = @id'
);
const deleteWorkout = db.prepare('DELETE FROM workouts WHERE id = ?');
const countSessions = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE workout_id = ?');

router.put('/:id', (req, res) => {
  const existing = selectWorkoutById.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'workout not found' });

  const { name, structure } = req.body;
  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  const structureError = validateStructure(structure);
  if (structureError) return res.status(400).json({ error: structureError });

  updateWorkout.run({ id: req.params.id, name, structure: JSON.stringify(structure) });
  res.json(toResponse(selectWorkoutById.get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  const existing = selectWorkoutById.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'workout not found' });

  // Past rides keep their own copy of the name (sessions.workout_name), so
  // deleting a template never rewrites history — the reference is simply
  // cleared and the Chronicle still shows what was ridden.
  const rides = countSessions.get(req.params.id).n;
  db.transaction(() => {
    db.prepare('UPDATE sessions SET workout_id = NULL WHERE workout_id = ?').run(req.params.id);
    deleteWorkout.run(req.params.id);
  })();

  res.json({ deleted: true, rides_kept: rides });
});

export default router;
