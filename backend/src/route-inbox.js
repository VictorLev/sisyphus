import { readdirSync, statSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { rename, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import db from './db/index.js';
import { parseRouteFile, RouteFileError } from './route-file.js';
import { routesDir, addRoute } from './routes/route-library.js';

// The route inbox: a folder on the server (ROUTES_DIR/inbox, or ROUTES_INBOX)
// where an admin drops routes over the network share, one folder each:
//   inbox/<route name>/video.mp4
//                     /route.json
//                     /picture.jpg     (optional: .jpg, .png or .webp)
// A scan imports every complete folder: the route goes in the library under
// its route file's English title (or the folder's name), the video is moved
// (an instant rename on the same disk, a copy if not) and the folder is
// removed. A folder written to in the last minute is still being copied and
// waits for the next scan. A route already in the library (by title or
// folder name) isn't imported twice: if its folder's route file has
// metadata, the scan updates the route's name and details from it (no
// video needed) and removes the folder; if not, it's left alone.

const SETTLE_MS = 60 * 1000;
const PICTURE_MAX = 5 * 1024 * 1024;
const PICTURE_TYPES = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp' };

export function inboxDir() {
  return process.env.ROUTES_INBOX || path.join(routesDir(), 'inbox');
}

const q = {
  named: db.prepare('SELECT id FROM routes WHERE name = ? COLLATE NOCASE'),
  setMeta: db.prepare('UPDATE routes SET name = ?, meta = ? WHERE id = ?'),
  received: db.prepare('UPDATE routes SET video_received = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM routes WHERE id = ?'),
  setThumb: db.prepare('UPDATE routes SET thumb_type = ?, thumb_at = ? WHERE id = ?'),
};

// mtime can be copied over from the source file; ctime can't, so it says
// when the file last changed here.
const lastWrite = (stat) => Math.max(stat.mtimeMs, stat.ctimeMs);

function pictureIn(dir, files) {
  const file = files.find((f) => /^(picture|thumb|cover)\.(jpe?g|png|webp)$/i.test(f));
  if (!file) return null;
  const full = path.join(dir, file);
  return statSync(full).size <= PICTURE_MAX ? { file: full, ext: PICTURE_TYPES[path.extname(file).toLowerCase()] } : null;
}

// One folder: what's in it, and what a scan would do with it: `action`
// 'import' or 'update', or a `reason` it can't (a short code the Admin
// Panel translates).
function inspect(folder, now) {
  const dir = path.join(inboxDir(), folder);
  const files = readdirSync(dir);
  const video = path.join(dir, 'video.mp4');
  const route = path.join(dir, 'route.json');
  const entry = { folder, name: folder.trim().slice(0, 120), dir, video, route, size: null, action: null };
  if (!existsSync(route)) return { ...entry, reason: 'no-route' };
  const hasVideo = existsSync(video);
  const stats = [statSync(route), ...(hasVideo ? [statSync(video)] : [])];
  if (hasVideo) entry.size = stats[1].size;
  if (files.some((f) => f.endsWith('.part.mp4')) || stats.some((s) => now - lastWrite(s) < SETTLE_MS)) {
    return { ...entry, reason: 'copying' };
  }
  let parsed;
  try {
    parsed = parseRouteFile(readFileSync(route, 'utf8'));
  } catch (err) {
    if (err instanceof RouteFileError) return { ...entry, reason: 'bad-route', error: err.message };
    throw err;
  }
  entry.parsed = parsed;
  entry.name = parsed.metadata?.title_en || entry.name;
  const existing = q.named.get(entry.name) ?? q.named.get(entry.folder.trim());
  if (existing) {
    return parsed.metadata ? { ...entry, existingId: existing.id, action: 'update', reason: null } : { ...entry, reason: 'exists' };
  }
  if (!hasVideo) return { ...entry, reason: 'no-video' };
  return { ...entry, picture: pictureIn(dir, files), action: 'import', reason: null };
}

// Every folder in the inbox, sorted by name. An inbox that isn't there yet
// is empty.
export function listInbox(now = Date.now()) {
  let folders;
  try {
    folders = readdirSync(inboxDir(), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return folders.map((d) => inspect(d.name, now)).sort((a, b) => a.folder.localeCompare(b.folder));
}

// Moves a file, or copies it where a rename can't (another disk, or a folder
// the server may read but not change). Resolves to whether the original went.
async function moveFile(from, to) {
  try {
    await rename(from, to);
    return true;
  } catch (err) {
    if (!['EXDEV', 'EACCES', 'EPERM'].includes(err.code)) throw err;
  }
  await copyFile(from, to);
  try {
    await unlink(from);
    return true;
  } catch {
    return false;
  }
}

// Removes a finished folder. If the server can't, the name check keeps the
// next scan from importing it again; says whether it stayed.
function clearFolder(dir) {
  try {
    rmSync(dir, { recursive: true });
    return false;
  } catch {
    return true;
  }
}

// A route already in the library: new name and details from the file.
function updateOne(item) {
  q.setMeta.run(item.name, JSON.stringify(item.parsed.metadata), item.existingId);
  return { folder: item.folder, id: item.existingId, name: item.name, left: clearFolder(item.dir) };
}

async function importOne(item, createdBy) {
  const { parsed } = item;
  const id = addRoute({ name: item.name, parsed, videoSize: item.size, createdBy });
  const target = path.join(routesDir(), String(id));
  try {
    mkdirSync(target, { recursive: true });
    await moveFile(item.video, path.join(target, 'video.mp4'));
  } catch (err) {
    q.remove.run(id);
    rmSync(target, { recursive: true, force: true });
    throw err;
  }
  q.received.run(item.size, id);
  if (item.picture) {
    await copyFile(item.picture.file, path.join(target, `thumb.${item.picture.ext}`));
    q.setThumb.run(item.picture.ext, new Date().toISOString(), id);
  }
  return { folder: item.folder, id, name: item.name, left: clearFolder(item.dir) };
}

async function scan(createdBy, now) {
  const imported = [];
  const updated = [];
  const skipped = [];
  for (const item of listInbox(now)) {
    if (item.reason) {
      skipped.push({ folder: item.folder, reason: item.reason, ...(item.error ? { error: item.error } : {}) });
      continue;
    }
    try {
      if (item.action === 'update') updated.push(updateOne(item));
      else imported.push(await importOne(item, createdBy));
    } catch (err) {
      skipped.push({ folder: item.folder, reason: 'failed', error: err.message });
    }
  }
  return { imported, updated, skipped };
}

// One scan at a time: a second call while one runs gets the same result.
let running = null;
export function scanInbox({ createdBy = null, now = Date.now() } = {}) {
  running ??= scan(createdBy, now).finally(() => { running = null; });
  return running;
}
