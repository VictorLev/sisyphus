import { Router } from 'express';
import db from '../db/index.js';
import { recordFtp } from '../ftp-history.js';

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
    default_mode: 'erg', // 'gears' | 'erg'
    // Resistance units added per +1% of grade. The trainer's usable range is
    // small (0..20), so a climb has to cost only a couple of units to leave
    // room for the gears to matter.
    resistance_per_grade: 0.4,
    // YouTube virtual rides for the ride screen, one link per line,
    // optionally named: "Swiss Alps | https://youtu.be/...".
    scenery_videos: '',
    // 'auto' follows the browser (French if it prefers French, else English).
    language: 'auto',
    // 'dark' (the original look) or 'light' (lighter beige).
    theme: 'dark',
  },
};

// Each rider has their own profile and settings. A rider with nothing saved
// yet simply reads the defaults.
const selectConfig = db.prepare('SELECT value FROM user_config WHERE user_id = ? AND key = ?');
const upsertConfig = db.prepare(
  `INSERT INTO user_config (user_id, key, value, updated_at) VALUES (@userId, @key, @value, datetime('now'))
   ON CONFLICT(user_id, key) DO UPDATE SET value = @value, updated_at = datetime('now')`
);

export function writeConfig(userId, key, value) {
  upsertConfig.run({ userId, key, value: JSON.stringify(value) });
}

export function readConfig(userId, key) {
  const row = selectConfig.get(userId, key);
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
  if (s.language != null && !['auto', 'en', 'fr'].includes(s.language)) {
    return "language must be 'auto', 'en' or 'fr'";
  }
  if (s.theme != null && !['dark', 'light'].includes(s.theme)) {
    return "theme must be 'dark' or 'light'";
  }
  if (s.default_mode != null && !['gears', 'erg'].includes(s.default_mode)) {
    return "default_mode must be 'gears' or 'erg'";
  }
  return null;
}

for (const key of ['profile', 'settings']) {
  router.get(`/${key}`, (req, res) => res.json(readConfig(req.user.id, key)));

  router.put(`/${key}`, (req, res) => {
    const { value, error } = sanitise(key, req.body ?? {});
    if (error) return res.status(400).json({ error });

    const before = readConfig(req.user.id, key);
    const merged = { ...before, ...value };
    if (key === 'settings') {
      const invalid = validateSettings(merged);
      if (invalid) return res.status(400).json({ error: invalid });
      // start_gear is clamped rather than rejected: lowering gear_count
      // shouldn't fail the save, it should just pull the start gear in.
      merged.start_gear = Math.min(Math.max(1, Math.round(merged.start_gear)), merged.gear_count);
    }
    writeConfig(req.user.id, key, merged);
    // A hand-typed FTP is part of the rider's FTP history too.
    if (key === 'profile') {
      recordFtp({ userId: req.user.id, ftp: merged.ftp, previous: before.ftp, source: 'manual' });
    }
    res.json(merged);
  });
}

export default router;
