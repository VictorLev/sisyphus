// The Admin Panel's API: admins only; riders, shared scenery, releases.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login, client } from './helpers.js';

const tmp = useTempDb();

describe('admin API', () => {
  let server;
  let base;
  let admin;
  let rider;

  before(async () => {
    ({ server, base } = await startServer());
    await addUser('boss', 'b', { isAdmin: true, displayName: 'Boss' });
    await addUser('rider', 'r', { displayName: 'Rider' });
    admin = await login(base, 'boss', 'b');
    rider = await login(base, 'rider', 'r');
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('riders can\'t get in', async () => {
    for (const [method, url] of [['get', '/api/admin/users'], ['post', '/api/admin/users'], ['get', '/api/admin/releases'], ['put', '/api/admin/scenery']]) {
      assert.equal((await rider[method](url, method === 'get' ? undefined : {})).status, 403, `${method} ${url}`);
    }
  });

  test('lists every rider with their rides', async () => {
    const users = await (await admin.get('/api/admin/users')).json();
    assert.deepEqual(users.map((u) => [u.username, u.is_admin, u.rides, u.you]), [['boss', true, 0, true], ['rider', false, 0, false]]);
  });

  test('creates a rider with a temporary password that works, once shown', async () => {
    const res = await admin.post('/api/admin/users', { username: 'alexis', display_name: 'Alexis' });
    assert.equal(res.status, 201);
    const { user, password } = await res.json();
    assert.equal(user.display_name, 'Alexis');
    assert.equal(password.length, 16);
    const alexis = await login(base, 'alexis', password);
    const mine = (await (await alexis.get('/api/workouts')).json()).filter((w) => !w.library);
    assert.equal(mine[0]?.name, 'My First Ride', 'set up like any new account');
    assert.equal((await admin.post('/api/admin/users', { username: 'alexis' })).status, 400, 'taken');
    assert.equal((await admin.post('/api/admin/users', { username: '!' })).status, 400, 'bad name');
  });

  test('a reset gives a new password and logs the rider out everywhere', async () => {
    const id = (await (await admin.get('/api/admin/users')).json()).find((u) => u.username === 'rider').id;
    const { password } = await (await admin.post(`/api/admin/users/${id}/reset-password`)).json();
    assert.equal((await rider.get('/api/auth/me')).status, 401, 'old session gone');
    rider = await login(base, 'rider', password);
    assert.equal((await rider.get('/api/auth/me')).status, 200);
    const selfId = (await (await admin.get('/api/admin/users')).json()).find((u) => u.you).id;
    assert.equal((await admin.post(`/api/admin/users/${selfId}/reset-password`)).status, 400, 'not your own');
  });

  test('deleting shows what goes, refuses yourself, then removes the rider', async () => {
    const users = await (await admin.get('/api/admin/users')).json();
    const alexis = users.find((u) => u.username === 'alexis');
    const data = await (await admin.get(`/api/admin/users/${alexis.id}/data`)).json();
    assert.equal(data.workouts, 1, 'their My First Ride');
    assert.equal((await admin.del(`/api/admin/users/${users.find((u) => u.you).id}`)).status, 400);
    assert.equal((await admin.del(`/api/admin/users/${alexis.id}`)).status, 200);
    assert.ok(!(await (await admin.get('/api/admin/users')).json()).some((u) => u.username === 'alexis'));
  });

  test('an admin gives a rider drachmas, added to their balance', async () => {
    const id = (await (await admin.get('/api/admin/users')).json()).find((u) => u.username === 'rider').id;
    const before = (await (await rider.get('/api/shop/me')).json()).balance;
    const res = await admin.post(`/api/admin/users/${id}/drachmas`, { amount: 10000, note: 'welcome' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).balance, before + 10000);
    const shop = await (await rider.get('/api/shop')).json();
    assert.equal(shop.earned.gifts, 10000);
    assert.equal(shop.balance, before + 10000);
    for (const amount of [0, -5, 1.5, 2_000_000, 'lots']) {
      assert.equal((await admin.post(`/api/admin/users/${id}/drachmas`, { amount })).status, 400, String(amount));
    }
    assert.equal((await rider.post(`/api/admin/users/${id}/drachmas`, { amount: 5 })).status, 403);
  });

  test('the shared scenery: up to 10 videos, for every rider', async () => {
    const start = await (await rider.get('/api/scenery')).json();
    assert.match(start.videos, /D6tC1pyrsTM/, 'the default ride until set');
    const ten = Array.from({ length: 10 }, (_, i) => `Ride ${i} | https://youtu.be/aaaaaaaaaa${i}`).join('\n');
    const saved = await (await admin.put('/api/admin/scenery', { videos: ten })).json();
    assert.equal(saved.videos.split(', ').length, 10);
    assert.equal((await (await rider.get('/api/scenery')).json()).videos, saved.videos);
    const eleven = `${ten}\nhttps://youtu.be/bbbbbbbbbbb`;
    assert.equal((await admin.put('/api/admin/scenery', { videos: eleven })).status, 400);
  });

  test('release notes: the history, newest first', async () => {
    const { releases } = await (await admin.get('/api/admin/releases')).json();
    assert.equal(releases[0].version, 'next');
    assert.ok(releases.some((r) => r.version === 'v1.0.0' && r.notes.length));
  });

  test('anonymous: nothing', async () => {
    assert.equal((await client(base).get('/api/admin/users')).status, 401);
  });
});
