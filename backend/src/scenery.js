// The shared scenery: up to 10 YouTube rides for everyone, set in the Admin
// Panel. Stored as the same "Name | link, ..." text the app has always
// used. Until an admin sets it, it's the first admin's own list from
// before (scenery was personal then), or the default ride.

import db from './db/index.js';

export const MAX_SCENERY = 10;
export const DEFAULT_SCENERY = 'https://www.youtube.com/watch?v=D6tC1pyrsTM&list=PLiNcRO_l_QWfhgFUDiBBaJ5NEF7xyfb_f&t=60s';

const q = {
  get: db.prepare("SELECT value FROM site_config WHERE key = 'scenery_videos'"),
  put: db.prepare(
    `INSERT INTO site_config (key, value) VALUES ('scenery_videos', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ),
  adminPersonal: db.prepare(
    `SELECT c.value FROM user_config c JOIN users u ON u.id = c.user_id
     WHERE u.is_admin = 1 AND c.key = 'settings' ORDER BY u.id LIMIT 1`
  ),
};

// The entries of a scenery text (commas or newlines between them).
export const sceneryEntries = (text) => String(text ?? '').split(/[,\n]/).map((s) => s.trim()).filter((s) => /https?:\/\//.test(s));

export function getScenery() {
  const row = q.get.get();
  if (row) return JSON.parse(row.value);
  try {
    const personal = JSON.parse(q.adminPersonal.get()?.value ?? '{}').scenery_videos;
    if (personal && sceneryEntries(personal).length) return sceneryEntries(personal).slice(0, MAX_SCENERY).join(', ');
  } catch { /* fall through */ }
  return DEFAULT_SCENERY;
}

export function setScenery(text) {
  q.put.run(JSON.stringify(String(text)));
}
