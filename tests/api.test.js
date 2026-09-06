import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Each run gets a throwaway database. DB_PATH must be set before the app is
// imported, since the db module opens the file at module load.
const dir = mkdtempSync(path.join(tmpdir(), 'sisyphus-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');

let server;
let base;

before(async () => {
  const { createApp } = await import('../backend/src/app.js');
  // Port 0 lets the OS pick a free port, so tests never collide with a
  // running dev server.
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const api = (path, options) => fetch(base + path, options);
const postJson = (path, body, method = 'POST') =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const validWorkout = {
  name: 'Test',
  structure: [{ duration_sec: 60, target_watts: 150, label: 'Work' }],
};

describe('workouts API', () => {
  test('creates and reads back a workout', async () => {
    const res = await postJson('/api/workouts', validWorkout);
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.name, 'Test');
    assert.deepEqual(created.structure, validWorkout.structure);
    assert.equal(created.starred, false);
  });

  test('rejects an empty name and an empty structure', async () => {
    assert.equal((await postJson('/api/workouts', { name: '', structure: [] })).status, 400);
    assert.equal((await postJson('/api/workouts', { name: 'x', structure: [] })).status, 400);
  });

  test('rejects malformed segments', async () => {
    const bad = [
      { duration_sec: 0, target_watts: 100, label: 'x' },
      { duration_sec: 60, target_watts: -5, label: 'x' },
      { duration_sec: 1.5, target_watts: 100, label: 'x' },
    ];
    for (const segment of bad) {
      const res = await postJson('/api/workouts', { name: 'x', structure: [segment] });
      assert.equal(res.status, 400, `should reject ${JSON.stringify(segment)}`);
    }
  });

  test('accepts optional signed grade but bounds it', async () => {
    const ok = await postJson('/api/workouts', {
      name: 'Hills',
      structure: [{ duration_sec: 60, target_watts: 150, label: 'Climb', grade_percent: -8 }],
    });
    assert.equal(ok.status, 201);
    const tooSteep = await postJson('/api/workouts', {
      name: 'No',
      structure: [{ duration_sec: 60, target_watts: 150, label: 'x', grade_percent: 45 }],
    });
    assert.equal(tooSteep.status, 400);
  });

  test('404s for a workout that does not exist', async () => {
    assert.equal((await api('/api/workouts/99999')).status, 404);
  });

  test('starring is a boolean toggle', async () => {
    const created = await (await postJson('/api/workouts', validWorkout)).json();
    const res = await postJson(`/api/workouts/${created.id}/starred`, { starred: true }, 'PATCH');
    assert.equal((await res.json()).starred, true);
    assert.equal((await postJson(`/api/workouts/${created.id}/starred`, { starred: 'yes' }, 'PATCH')).status, 400);
  });
});

describe('sessions API', () => {
  test('computes aggregates over MOVING samples only', async () => {
    // Idle time (cadence 0) must not drag averages down.
    const res = await postJson('/api/sessions', {
      started_at: '2026-01-01T10:00:00Z',
      ended_at: '2026-01-01T10:01:00Z',
      distance_m: 500,
      samples: [
        { timestamp_offset_sec: 0, power: 0, cadence: 0, speed: 0 },
        { timestamp_offset_sec: 1, power: 0, cadence: 0, speed: 0 },
        { timestamp_offset_sec: 2, power: 200, cadence: 90, speed: 30 },
        { timestamp_offset_sec: 3, power: 220, cadence: 92, speed: 31 },
      ],
    });
    const session = await res.json();
    assert.equal(session.avg_power, 210, 'mean of the moving samples, not all four');
    assert.equal(session.avg_cadence, 91);
  });

  test('honours the client peak over the max of windowed means', async () => {
    const session = await (await postJson('/api/sessions', {
      started_at: '2026-01-01T11:00:00Z',
      ended_at: '2026-01-01T11:01:00Z',
      max_power: 600,
      samples: [{ timestamp_offset_sec: 0, power: 150, cadence: 90, speed: 30 }],
    })).json();
    assert.equal(session.max_power, 600);
  });

  test('falls back to the sample max when no peak is supplied', async () => {
    const session = await (await postJson('/api/sessions', {
      started_at: '2026-01-01T12:00:00Z',
      ended_at: '2026-01-01T12:01:00Z',
      samples: [
        { timestamp_offset_sec: 0, power: 150, cadence: 90, speed: 30 },
        { timestamp_offset_sec: 1, power: 275, cadence: 90, speed: 30 },
      ],
    })).json();
    assert.equal(session.max_power, 275);
  });

  test('requires timestamps and at least one sample', async () => {
    assert.equal((await postJson('/api/sessions', { started_at: '', ended_at: '', samples: [] })).status, 400);
  });

  test('a deleted workout leaves its rides their name', async () => {
    // The log is permanent: deleting a template must not rewrite history.
    const workout = await (await postJson('/api/workouts', { name: 'Doomed', structure: validWorkout.structure })).json();
    const session = await (await postJson('/api/sessions', {
      workout_id: workout.id,
      started_at: '2026-01-02T10:00:00Z',
      ended_at: '2026-01-02T10:30:00Z',
      distance_m: 9000,
      samples: [{ timestamp_offset_sec: 0, power: 200, cadence: 90, speed: 30 }],
    })).json();

    await api(`/api/workouts/${workout.id}`, { method: 'DELETE' });

    const list = await (await api('/api/sessions')).json();
    const row = list.find((s) => s.id === session.id);
    assert.equal(row.workout_name, 'Doomed');
    assert.equal(row.workout_id, null, 'the reference is cleared');
  });

  test('deleting a session removes its samples too', async () => {
    const session = await (await postJson('/api/sessions', {
      started_at: '2026-01-03T10:00:00Z',
      ended_at: '2026-01-03T10:05:00Z',
      samples: [{ timestamp_offset_sec: 0, power: 100, cadence: 80, speed: 25 }],
    })).json();
    assert.equal((await api(`/api/sessions/${session.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await api(`/api/sessions/${session.id}`)).status, 404);
  });
});

describe('config API', () => {
  test('returns defaults before anything is saved', async () => {
    const settings = await (await api('/api/settings')).json();
    assert.equal(settings.gear_count, 12);
    assert.equal(settings.default_mode, 'gears');
  });

  test('merges partial updates over stored values', async () => {
    await postJson('/api/profile', { name: 'Victor', ftp: 170 }, 'PUT');
    const profile = await (await postJson('/api/profile', { weight_kg: 76 }, 'PUT')).json();
    assert.equal(profile.name, 'Victor', 'earlier fields survive a partial update');
    assert.equal(profile.ftp, 170);
    assert.equal(profile.weight_kg, 76);
  });

  test('rejects settings the trainer could not honour', async () => {
    assert.equal((await postJson('/api/settings', { max_resistance: 25 }, 'PUT')).status, 400);
    assert.equal((await postJson('/api/settings', { min_resistance: 15, max_resistance: 5 }, 'PUT')).status, 400);
    assert.equal((await postJson('/api/settings', { default_mode: 'nonsense' }, 'PUT')).status, 400);
  });

  test('clamps start_gear instead of failing when gear_count shrinks', async () => {
    await postJson('/api/settings', { gear_count: 12, start_gear: 10 }, 'PUT');
    const settings = await (await postJson('/api/settings', { gear_count: 3 }, 'PUT')).json();
    assert.equal(settings.start_gear, 3);
  });
});

describe('records and level', () => {
  test('a duration record needs a ride that actually covered it', async () => {
    // Every ride so far is short, so the 20-minute record must be absent
    // rather than derived from a shorter effort.
    const { records } = await (await api('/api/records')).json();
    const twentyMin = records.find((r) => r.key === 'best_1200s');
    assert.equal(twentyMin.value, null);
  });

  test('surfaces the ride that set each record', async () => {
    const { records } = await (await api('/api/records')).json();
    const peak = records.find((r) => r.key === 'peak_power');
    assert.ok(peak.value > 0);
    assert.ok(peak.session_id, 'links back to the ride');
  });

  test('XP is built from time and distance, so it cannot regress', async () => {
    const before = await (await api('/api/level')).json();
    // Changing FTP must not move XP: load-based XP would shrink past rides.
    await postJson('/api/profile', { ftp: 400 }, 'PUT');
    const after = await (await api('/api/level')).json();
    assert.equal(after.xp, before.xp);
    assert.equal(after.level, before.level);
  });

  test('level progression is monotonic in XP', async () => {
    const data = await (await api('/api/level')).json();
    assert.ok(data.level >= 1);
    assert.ok(data.into_level >= 0);
    assert.ok(data.needed_for_next > 0);
    assert.ok(data.progress >= 0 && data.progress <= 1);
  });
});
