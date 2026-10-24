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
// the folder's name, the video is moved (an instant rename on the same disk,
// a copy if not) and the folder is removed. A folder written to in the last
// minute is still being copied and waits for the next scan; a name already
// in the library is skipped, so scanning twice is harmless.

const SETTLE_MS = 60 * 1000;
const PICTURE_MAX = 5 * 1024 * 1024;
const PICTURE_TYPES = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp' };

export function inboxDir() {
  return process.env.ROUTES_INBOX || path.join(routesDir(), 'inbox');
}

const q = {
  named: db.prepare('SELECT id FROM routes WHERE name = ? COLLATE NOCASE'),
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

// One folder: what's in it, and whether it can be imported now. `reason` is
// a short code (the Admin Panel translates it).
function inspect(folder, now) {
  const dir = path.join(inboxDir(), folder);
  const files = readdirSync(dir);
  const name = folder.trim().slice(0, 120);
  const video = path.join(dir, 'video.mp4');
  const route = path.join(dir, 'route.json');
  const entry = { folder, name, dir, video, route, size: null };
  if (!existsSync(video)) return { ...entry, reason: 'no-video' };
  if (!existsSync(route)) return { ...entry, reason: 'no-route' };
  const stat = statSync(video);
  entry.size = stat.size;
  if (files.some((f) => f.endsWith('.part.mp4')) || [stat, statSync(route)].some((s) => now - lastWrite(s) < SETTLE_MS)) {
    return { ...entry, reason: 'copying' };
  }
  if (q.named.get(name)) return { ...entry, reason: 'exists' };
  return { ...entry, picture: pictureIn(dir, files), reason: null };
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

async function importOne(item, createdBy) {
  const parsed = parseRouteFile(readFileSync(item.route, 'utf8'));
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
  // Done with the folder; if the server can't remove it, the name check
  // keeps the next scan from importing it again.
  let left = false;
  try {
    rmSync(item.dir, { recursive: true });
  } catch {
    left = true;
  }
  return { folder: item.folder, id, name: item.name, left };
}

async function scan(createdBy, now) {
  const imported = [];
  const skipped = [];
  for (const item of listInbox(now)) {
    if (item.reason) {
      skipped.push({ folder: item.folder, reason: item.reason });
      continue;
    }
    try {
      imported.push(await importOne(item, createdBy));
    } catch (err) {
      skipped.push({ folder: item.folder, reason: err instanceof RouteFileError ? 'bad-route' : 'failed', error: err.message });
    }
  }
  return { imported, skipped };
}

// One scan at a time: a second call while one runs gets the same result.
let running = null;
export function scanInbox({ createdBy = null, now = Date.now() } = {}) {
  running ??= scan(createdBy, now).finally(() => { running = null; });
  return running;
}
