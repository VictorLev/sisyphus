// The route inbox: folders dropped on the server, imported by a scan.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();
process.env.ROUTES_DIR = path.join(tmp.dir, 'routes');
const { inboxDir, listInbox, scanInbox } = await import('../backend/src/route-inbox.js');

const routeFile = {
  geometry: [0, 1000, 2000].map((d) => ({ distance: d, altitude: 10 + d * 0.01 })),
  video_points: [0, 2000].map((d) => ({ distance: d, time: d / 10 })),
};
const later = () => Date.now() + 2 * 60 * 1000; // past the "still copying" minute

function drop(folder, files) {
  const dir = path.join(inboxDir(), folder);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}

describe('route inbox', () => {
  let server;
  let base;
  let admin;
  let rider;

  before(async () => {
    ({ server, base } = await startServer());
    await addUser('boss', 'b', { isAdmin: true });
    await addUser('rider', 'r');
    admin = await login(base, 'boss', 'b');
    rider = await login(base, 'rider', 'r');
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('no inbox folder yet is an empty inbox', async () => {
    assert.deepEqual(listInbox(), []);
    const res = await admin.get('/api/admin/inbox');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).folders, []);
  });

  test('only an admin sees or scans it', async () => {
    assert.equal((await rider.get('/api/admin/inbox')).status, 403);
    assert.equal((await rider.post('/api/admin/inbox/scan', {})).status, 403);
  });

  test('says what each folder lacks, and waits while one is still being copied', async () => {
    drop('Half done', { 'route.json': JSON.stringify(routeFile) });
    drop('Fresh Road', { 'video.mp4': Buffer.alloc(500, 7), 'route.json': JSON.stringify(routeFile) });
    const { folders } = await (await admin.get('/api/admin/inbox')).json();
    assert.deepEqual(folders.map((f) => [f.folder, f.reason]), [['Fresh Road', 'copying'], ['Half done', 'no-video']]);
    const result = await (await admin.post('/api/admin/inbox/scan', {})).json();
    assert.equal(result.imported.length, 0, 'nothing written in the last minute is taken');
  });

  test('a scan imports a ready folder: the route, its video and picture, then the folder goes', async () => {
    const dir = drop('Col du Test - France', {
      'video.mp4': Buffer.alloc(1200, 3),
      'route.json': `﻿${JSON.stringify(routeFile)}\n0123456789abcdef`,
      'picture.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    drop('Broken', { 'video.mp4': Buffer.alloc(10), 'route.json': 'not json' });
    const { imported, skipped } = await scanInbox({ now: later() });
    assert.deepEqual(imported.map((r) => r.name), ['Col du Test - France', 'Fresh Road']);
    assert.deepEqual(skipped.map((s) => [s.folder, s.reason]), [['Broken', 'bad-route'], ['Half done', 'no-video']]);
    assert.equal(existsSync(dir), false, 'the folder is gone');

    const routes = await (await rider.get('/api/routes')).json();
    const col = routes.find((r) => r.name === 'Col du Test - France');
    assert.equal(col.ready, true);
    assert.equal(col.distance_m, 2000);
    assert.ok(col.thumbnail);
    const video = await rider.get(`/api/routes/${col.id}/video`);
    assert.equal(video.status, 200);
    assert.equal(Buffer.from(await video.arrayBuffer()).length, 1200);
    assert.ok(existsSync(path.join(process.env.ROUTES_DIR, String(col.id), 'thumb.jpg')));
    assert.equal(readFileSync(path.join(process.env.ROUTES_DIR, String(col.id), 'video.mp4'))[0], 3);
  });

  test('a name already in the library is left alone, so scanning twice is harmless', async () => {
    drop('col du test - france', { 'video.mp4': Buffer.alloc(10), 'route.json': JSON.stringify(routeFile) });
    const { imported, skipped } = await scanInbox({ now: later() });
    assert.equal(imported.length, 0);
    assert.ok(skipped.some((s) => s.folder === 'col du test - france' && s.reason === 'exists'));
    assert.equal((await (await rider.get('/api/routes')).json()).length, 2);
  });
});
