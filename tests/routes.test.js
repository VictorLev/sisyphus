// Routes: importing a route file and its video (in pieces), streaming it,
// and riding it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();
process.env.ROUTES_DIR = path.join(tmp.dir, 'routes');
const { parseRouteFile, RouteFileError } = await import('../backend/src/route-file.js');

// A made-up 2 km road: up 20 m over the first km, flat after; filmed at
// 10 m/s, so the 2 km take 200 s of video.
const routeFile = {
  geometry: [0, 500, 1000, 1500, 2000].map((d) => ({ distance: d, altitude: 10 + Math.min(d, 1000) * 0.02, latitude: 45.5, longitude: -73.6 + d / 1e5 })),
  video_points: [0, 1000, 2000].map((d) => ({ distance: d, time: d / 10 })),
};

describe('route file', () => {
  test('reads geometry and video points, with the totals', () => {
    const r = parseRouteFile(routeFile);
    assert.equal(r.points.length, 5);
    assert.deepEqual(r.points[1], { d: 500, alt: 20, lat: 45.5, lon: -73.595 });
    assert.deepEqual(r.videoPoints[2], { d: 2000, t: 200 });
    assert.deepEqual([r.distanceM, r.ascentM, r.durationS], [2000, 20, 200]);
  });

  test('as text, with a byte-order mark and a checksum line after the JSON', () => {
    const r = parseRouteFile(`﻿${JSON.stringify(routeFile)}\ne2d557d6ef104fc8be5455119ec0bdb3`);
    assert.equal(r.distanceM, 2000);
  });

  test('refuses what it can\'t ride', () => {
    assert.throws(() => parseRouteFile('nope'), RouteFileError);
    assert.throws(() => parseRouteFile({ geometry: [], video_points: [] }), /at least 2/);
    assert.throws(() => parseRouteFile({ ...routeFile, geometry: [{ distance: 5, altitude: 1 }, { distance: 2, altitude: 1 }] }), /backwards/);
    assert.throws(() => parseRouteFile({ ...routeFile, video_points: [{ distance: 0, time: 5 }, { distance: 10, time: 1 }] }), /backwards/);
  });
});

describe('routes API', () => {
  let server;
  let base;
  let admin;
  let rider;
  const video = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

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

  const put = (who, id, offset, bytes) => fetch(`${base}/api/routes/${id}/video?offset=${offset}`, {
    method: 'PUT', headers: { Cookie: who.cookie, 'Content-Type': 'application/octet-stream' }, body: bytes,
  });

  let routeId;

  test('an admin imports a route; it isn\'t ready until the whole video is in', async () => {
    const res = await admin.post('/api/routes', { name: 'Test Road', route: routeFile, video_size: video.length });
    assert.equal(res.status, 201);
    const created = await res.json();
    routeId = created.id;
    assert.equal(created.ready, false);
    assert.equal(created.profile.length, 60);
    assert.equal((await rider.get(`/api/routes/${routeId}/video`)).status, 409, 'no video yet');
  });

  test('the video goes up in order, and a piece at the wrong place says where to resume', async () => {
    assert.equal((await put(admin, routeId, 0, video.subarray(0, 400))).status, 200);
    const wrong = await put(admin, routeId, 0, video.subarray(0, 400));
    assert.equal(wrong.status, 409);
    assert.equal((await wrong.json()).video_received, 400);
    const last = await (await put(admin, routeId, 400, video.subarray(400))).json();
    assert.equal(last.ready, true);
    assert.deepEqual(readFileSync(path.join(process.env.ROUTES_DIR, String(routeId), 'video.mp4')), video);
    assert.equal((await put(admin, routeId, 1000, Buffer.from([1]))).status, 400, 'nothing past the size given');
  });

  test('every rider sees the route and streams its video, from any point', async () => {
    const list = await (await rider.get('/api/routes')).json();
    assert.deepEqual(list.map((r) => [r.name, r.ready, r.distance_m, r.ascent_m]), [['Test Road', true, 2000, 20]]);
    const full = await (await rider.get(`/api/routes/${routeId}`)).json();
    assert.equal(full.points.length, 5);
    assert.equal(full.video_points.length, 3);
    const part = await rider.get(`/api/routes/${routeId}/video`, { Range: 'bytes=100-199' });
    assert.equal(part.status, 206);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), video.subarray(100, 200));
  });

  test('each rider stars routes for themselves', async () => {
    assert.equal((await (await rider.get('/api/routes')).json())[0].starred, false);
    const starred = await (await rider.patch(`/api/routes/${routeId}/starred`, { starred: true })).json();
    assert.equal(starred.starred, true);
    assert.equal((await (await rider.get('/api/routes')).json())[0].starred, true);
    assert.equal((await (await admin.get('/api/routes')).json())[0].starred, false, 'not starred for the admin');
    assert.equal((await rider.patch(`/api/routes/${routeId}/starred`, { starred: 'yes' })).status, 400);
    assert.equal((await rider.patch('/api/routes/9999/starred', { starred: true })).status, 404);
  });

  test('only an admin imports, renames or deletes', async () => {
    assert.equal((await rider.post('/api/routes', { name: 'X', route: routeFile, video_size: 10 })).status, 403);
    assert.equal((await put(rider, routeId, 1000, Buffer.from([1]))).status, 403);
    assert.equal((await rider.patch(`/api/routes/${routeId}`, { name: 'Mine' })).status, 403);
    assert.equal((await rider.del(`/api/routes/${routeId}`)).status, 403);
    assert.equal((await admin.post('/api/routes', { name: 'Bad', route: { geometry: [] }, video_size: 10 })).status, 400);
  });

  test('a ride on a route is named after it and keeps it after the route is deleted', async () => {
    const saved = await (await rider.post('/api/sessions', {
      route_id: routeId,
      started_at: '2026-10-24T22:00:00.000Z', ended_at: '2026-10-24T22:05:00.000Z', distance_m: 1500,
      samples: [{ timestamp_offset_sec: 0, power: 200, cadence: 85, speed: 30 }],
    })).json();
    assert.deepEqual([saved.workout_name, saved.route_id], ['Test Road', routeId]);
    assert.equal((await admin.patch(`/api/routes/${routeId}`, { name: 'Test Road 2' })).status, 200);
    assert.equal((await admin.del(`/api/routes/${routeId}`)).status, 204);
    assert.ok(!existsSync(path.join(process.env.ROUTES_DIR, String(routeId))), 'video files removed');
    const after = await (await rider.get(`/api/sessions/${saved.id}`)).json();
    assert.equal(after.workout_name, 'Test Road', 'the ride keeps its name');
  });
});
