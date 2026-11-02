// Riders' browser logs, sent to the server and read in the Admin Panel.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';
import { unsent } from '../frontend/js/log.js';

const tmp = useTempDb();

describe('client logs', () => {
  let server;
  let admin;
  let max;

  before(async () => {
    let base;
    ({ server, base } = await startServer());
    await addUser('boss', 'b', { displayName: 'Boss', isAdmin: true });
    await addUser('max', 'm', { displayName: 'Max' });
    admin = await login(base, 'boss', 'b');
    max = await login(base, 'max', 'm');
  });

  after(() => {
    server?.close();
    tmp.cleanup();
  });

  test('a rider sends lines; malformed ones are dropped', async () => {
    const res = await max.post('/api/logs', {
      entries: [
        { at: '2026-11-01T20:00:00.000Z', level: 'info', message: 'Trainer connected: ASCEND S2' },
        { at: '2026-11-01T20:01:00.000Z', level: 'warn', message: '[app] resistance write failed: opcode 0x04: op code not supported' },
        { at: '2026-11-01T20:02:00.000Z', level: 'error', message: 'x'.repeat(5000) },
        { at: 'yesterday-ish', level: 'error', message: 'bad date' },
        { at: '2026-11-01T20:03:00.000Z', level: 'debug', message: 'bad level' },
        null,
      ],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { kept: 3 });
  });

  test('admins read them newest first, filtered by rider and level', async () => {
    const all = await (await admin.get('/api/admin/logs')).json();
    assert.equal(all.length, 3);
    assert.equal(all[0].level, 'error');
    assert.equal(all[0].message.length, 1000);
    assert.equal(all[2].message, 'Trainer connected: ASCEND S2');
    assert.equal(all[2].username, 'max');
    assert.equal(all[2].display_name, 'Max');

    const warn = await (await admin.get('/api/admin/logs?level=warn&user=max')).json();
    assert.deepEqual(warn.map((r) => r.level), ['error', 'warn']);
    assert.equal((await (await admin.get('/api/admin/logs?user=boss')).json()).length, 0);
    assert.equal((await (await admin.get('/api/admin/logs?since=2026-11-01T20:01:30Z')).json()).length, 1);
    assert.equal((await admin.get('/api/admin/logs?since=soon')).status, 400);
  });

  test('riders can\'t read anyone\'s logs', async () => {
    assert.equal((await max.get('/api/admin/logs')).status, 403);
  });

  test('the browser sends only what it hasn\'t sent', () => {
    const entries = [{ at: '2026-11-01T20:00:00.000Z' }, { at: '2026-11-01T20:01:00.000Z' }];
    assert.equal(unsent(entries, null).length, 2);
    assert.deepEqual(unsent(entries, '2026-11-01T20:00:00.000Z'), [entries[1]]);
    assert.equal(unsent(entries, '2026-11-01T20:01:00.000Z').length, 0);
  });
});
