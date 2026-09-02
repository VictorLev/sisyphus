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

export default router;
