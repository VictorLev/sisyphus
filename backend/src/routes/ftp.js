import { Router } from 'express';
import db from '../db/index.js';
import { estimateFtp } from '../power.js';
import { readConfig, writeConfig } from './config.js';
import { recordFtp } from '../ftp-history.js';

const router = Router();

// The rider's own ride, with the test spec of the workout it followed (null
// unless that workout is an FTP test).
const selectTestSession = db.prepare(
  `SELECT s.id, w.test FROM sessions s
   LEFT JOIN workouts w ON w.id = s.workout_id
   WHERE s.id = ? AND s.user_id = ?`
);
const selectSamples = db.prepare(
  'SELECT timestamp_offset_sec, power FROM session_samples WHERE session_id = ? ORDER BY timestamp_offset_sec'
);
const selectApplied = db.prepare(
  "SELECT 1 FROM ftp_history WHERE user_id = ? AND session_id = ? AND source = 'test'"
);
const selectHistory = db.prepare(
  `SELECT id, ftp, previous_ftp, source, session_id, created_at
   FROM ftp_history WHERE user_id = ? ORDER BY id DESC LIMIT 50`
);

// The FTP a test ride measured. Not stored: like Feats, it is computed from
// the samples, so it always agrees with the ride as it is.
router.get('/estimate/:sessionId', (req, res) => {
  const row = selectTestSession.get(req.params.sessionId, req.user.id);
  if (!row) return res.status(404).json({ error: 'session not found' });
  if (!row.test) return res.status(400).json({ error: 'this ride was not an FTP test' });

  const test = JSON.parse(row.test);
  const result = estimateFtp(selectSamples.all(row.id), test);
  res.json({
    session_id: row.id,
    test,
    // null when the ride never covered the test window (ended early).
    best_average_w: result?.best_average_w ?? null,
    estimate_w: result?.estimate_w ?? null,
    current_ftp: readConfig(req.user.id, 'profile').ftp,
    already_applied: !!selectApplied.get(req.user.id, row.id),
  });
});

// Sets the rider's FTP and records it. With the id of one of their own test
// rides it is recorded as a test result; otherwise as a manual change.
router.post('/', (req, res) => {
  const ftp = Number(req.body?.ftp);
  if (!Number.isFinite(ftp) || ftp < 30 || ftp > 2000) {
    return res.status(400).json({ error: 'ftp must be between 30 and 2000 watts' });
  }
  let sessionId = null;
  if (req.body?.session_id != null) {
    const row = selectTestSession.get(req.body.session_id, req.user.id);
    if (!row || !row.test) return res.status(400).json({ error: 'session_id must be one of your FTP test rides' });
    sessionId = row.id;
  }

  const profile = readConfig(req.user.id, 'profile');
  const updated = { ...profile, ftp: Math.round(ftp) };
  db.transaction(() => {
    writeConfig(req.user.id, 'profile', updated);
    recordFtp({
      userId: req.user.id,
      ftp: updated.ftp,
      previous: profile.ftp,
      source: sessionId ? 'test' : 'manual',
      sessionId,
    });
  })();
  res.json(updated);
});

router.get('/history', (req, res) => {
  res.json(selectHistory.all(req.user.id));
});

export default router;
