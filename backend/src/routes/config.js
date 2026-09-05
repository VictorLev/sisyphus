import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// Defaults live here so they are the single source of truth: a GET returns
// stored values merged over these, which means a newly-added setting gets a
// sensible value without any migration or client-side fallback.
const DEFAULTS = {
  profile: {
    name: '',
    ftp: 200, // watts — used to show %FTP against workout targets
    weight_kg: 75,
    max_hr: 185, // unused until an HR strap is added
  },
  settings: {
    gear_count: 12,
    min_resistance: 0, // trainer resistance domain is 0..20 (per 0x2AD6)
    max_resistance: 8,
    start_gear: 5, // 1-based
    power_smoothing_sec: 10, // live display smoothing window
    sample_interval_sec: 1, // how often a session sample is recorded
    default_mode: 'gears', // 'gears' | 'erg'
    // Resistance units added per +1% of grade. The trainer's usable range is
    // small (0..20), so a climb has to cost only a couple of units to leave
    // room for the gears to matter.
    resistance_per_grade: 0.4,
  },
};

const selectConfig = db.prepare('SELECT value FROM app_config WHERE key = ?');
const upsertConfig = db.prepare(
  `INSERT INTO app_config (key, value, updated_at) VALUES (@key, @value, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = datetime('now')`
);

function read(key) {
  const row = selectConfig.get(key);
  const stored = row ? JSON.parse(row.value) : {};
  return { ...DEFAULTS[key], ...stored };
}

// Only keys present in the defaults are accepted, so a typo or a stale client
// can't quietly write junk that later reads back as configuration.
function sanitise(key, body) {
  const defaults = DEFAULTS[key];
  const out = {};
  for (const [field, fallback] of Object.entries(defaults)) {
    if (!(field in body)) continue;
    const value = body[field];
    if (typeof fallback === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return { error: `${field} must be a non-negative number` };
      out[field] = n;
    } else {
      out[field] = String(value);
    }
  }
  return { value: out };
}

function validateSettings(s) {
  if (s.gear_count != null && (!Number.isInteger(s.gear_count) || s.gear_count < 1 || s.gear_count > 40)) {
    return 'gear_count must be an integer between 1 and 40';
  }
  if (s.max_resistance != null && s.max_resistance > 20) return 'max_resistance cannot exceed 20';
  if (s.min_resistance != null && s.max_resistance != null && s.min_resistance >= s.max_resistance) {
    return 'min_resistance must be below max_resistance';
  }
  if (s.default_mode != null && !['gears', 'erg'].includes(s.default_mode)) {
    return "default_mode must be 'gears' or 'erg'";
  }
  return null;
}

for (const key of ['profile', 'settings']) {
  router.get(`/${key}`, (req, res) => res.json(read(key)));

  router.put(`/${key}`, (req, res) => {
    const { value, error } = sanitise(key, req.body ?? {});
    if (error) return res.status(400).json({ error });

    const merged = { ...read(key), ...value };
    if (key === 'settings') {
      const invalid = validateSettings(merged);
      if (invalid) return res.status(400).json({ error: invalid });
      // start_gear is clamped rather than rejected: lowering gear_count
      // shouldn't fail the save, it should just pull the start gear in.
      merged.start_gear = Math.min(Math.max(1, Math.round(merged.start_gear)), merged.gear_count);
    }
    upsertConfig.run({ key, value: JSON.stringify(merged) });
    res.json(merged);
  });
}

export default router;
