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
    // With the rider's weight (Profile), sets the speed shown while riding.
    bike_weight_kg: 9,
    // How the trainer is driven (Settings → Trainer):
    //   'rear'  — the bike's own gears; resistance follows the grade only
    //   'gears' — virtual gears; resistance follows the gear and the grade
    //   'erg'   — the trainer holds each segment's target watts
    // Replaced default_mode ('gears' | 'erg'), which readConfig carries over.
    trainer_mode: 'erg',
    // Rear gears: the resistance on the flat, before any grade.
    rear_resistance: 5,
    // Resistance units added per +1% of grade (rear and virtual gears). The
    // trainer's usable range is small (0..20), so a climb has to cost only a
    // couple of units to leave room for the gears to matter.
    resistance_per_grade: 0.4,
    // YouTube virtual rides for the ride screen, separated by commas,
    // optionally named: "Swiss Alps | https://youtu.be/...". New accounts start with this ride (frontend/js/ui/scenery.js has the
    // same link as DEFAULT_SCENERY_LINK).
    scenery_videos: 'https://www.youtube.com/watch?v=D6tC1pyrsTM&list=PLiNcRO_l_QWfhgFUDiBBaJ5NEF7xyfb_f&t=60s',
    // Which video a ride starts on: 'random' or 'sequence' (the next in order).
    scenery_mode: 'random',
    // 'auto' follows the browser (French if it prefers French, else English).
    language: 'auto',
    // 'dark' (the original look) or 'light' (lighter beige).
    theme: 'dark',
    // Show the "Download for Strava" box on each ride. Off by default.
    strava_export: false,
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

export const TRAINER_MODES = ['rear', 'gears', 'erg'];

export function readConfig(userId, key) {
  const row = selectConfig.get(userId, key);
  const stored = row ? JSON.parse(row.value) : {};
  // Before trainer modes, the choice was default_mode ('gears' | 'erg').
  if (key === 'settings' && stored.trainer_mode === undefined && TRAINER_MODES.includes(stored.default_mode)) {
    stored.trainer_mode = stored.default_mode;
  }
  const { default_mode, ...current } = { ...DEFAULTS[key], ...stored };
  return current;
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
    } else if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') return { error: `${field} must be true or false` };
      out[field] = value;
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
  if (s.scenery_mode != null && !['random', 'sequence'].includes(s.scenery_mode)) {
    return "scenery_mode must be 'random' or 'sequence'";
  }
  if (s.theme != null && !['dark', 'light'].includes(s.theme)) {
    return "theme must be 'dark' or 'light'";
  }
  if (s.bike_weight_kg != null && !(s.bike_weight_kg >= 3 && s.bike_weight_kg <= 40)) {
    return 'bike_weight_kg must be between 3 and 40';
  }
  if (s.trainer_mode != null && !TRAINER_MODES.includes(s.trainer_mode)) {
    return "trainer_mode must be 'rear', 'gears' or 'erg'";
  }
  if (s.rear_resistance != null && !(s.rear_resistance >= 0 && s.rear_resistance <= 20)) {
    return 'rear_resistance must be between 0 and 20';
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
