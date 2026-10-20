// Every new account starts with "My First Ride", starred, in My Workouts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';

const tmp = useTempDb();
const { FIRST_RIDE } = await import('../backend/src/db/first-ride.js');

let server;
let base;

before(async () => {
  ({ server, base } = await startServer());
});

after(() => {
  server?.close();
  tmp.cleanup();
});

test('a new account has My First Ride, starred, in its own workouts', async () => {
  await addUser('newbie', 'n');
  const me = await login(base, 'newbie', 'n');
  const own = (await (await me.get('/api/workouts')).json()).filter((w) => !w.library);
  assert.equal(own.length, 1);
  assert.equal(own[0].name, 'My First Ride');
  assert.equal(own[0].starred, true);
  const full = await (await me.get(`/api/workouts/${own[0].id}`)).json();
  assert.deepEqual(full.structure, FIRST_RIDE.structure);
});

test('it is twenty easy minutes, in % of FTP', () => {
  assert.equal(FIRST_RIDE.structure.reduce((s, seg) => s + seg.duration_sec, 0), 20 * 60);
  assert.ok(FIRST_RIDE.structure.every((seg) => seg.target_ftp_pct <= 75));
});

test('each account gets its own copy, to edit, unstar or delete', async () => {
  await addUser('second', 's');
  const a = await login(base, 'newbie', 'n');
  const b = await login(base, 'second', 's');
  const mine = (await (await a.get('/api/workouts')).json()).find((w) => w.name === 'My First Ride');
  const theirs = (await (await b.get('/api/workouts')).json()).find((w) => w.name === 'My First Ride');
  assert.notEqual(mine.id, theirs.id);
  assert.equal((await a.patch(`/api/workouts/${mine.id}/starred`, { starred: false })).status, 200);
  assert.equal((await a.del(`/api/workouts/${mine.id}`)).status, 200);
  const still = (await (await b.get('/api/workouts')).json()).find((w) => w.id === theirs.id);
  assert.equal(still.starred, true, 'the other rider\'s copy is untouched');
});
