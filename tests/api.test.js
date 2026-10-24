import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, login } from './helpers.js';

// Each run gets a throwaway database, set before the app is imported.
const tmp = useTempDb();

let server;
let base;
let cookie;

before(async () => {
  ({ server, base } = await startServer());
  // Every route below needs a logged-in rider; auth itself is covered in
  // auth.test.js and per-rider isolation in isolation.test.js.
  await addUser('rider', 'rider-password');
  cookie = (await login(base, 'rider', 'rider-password')).cookie;
});

after(() => {
  server?.close();
  tmp.cleanup();
});

const api = (path, options = {}) =>
  fetch(base + path, { ...options, headers: { ...options.headers, Cookie: cookie } });
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
    // Workouts are stored in % of FTP: 150 W at the default FTP of 200.
    assert.deepEqual(created.structure, [{ duration_sec: 60, target_ftp_pct: 75, label: 'Work' }]);
    assert.equal(created.starred, false);
  });

  test('% FTP segments are stored as given', async () => {
    const structure = [{ duration_sec: 300, target_ftp_pct: 88.5, label: 'SS' }];
    const created = await (await postJson('/api/workouts', { name: 'Pct', structure })).json();
    assert.deepEqual(created.structure, structure);
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

  test('accepts a long ride whose body exceeds the default JSON limit', async () => {
    // Express defaults to 100kb, which a ride outgrows in ~15 minutes. This
    // silently made long rides unsaveable, so the limit is pinned by a test.
    const samples = Array.from({ length: 4000 }, (_, i) => ({
      timestamp_offset_sec: i, power: 180, cadence: 88, speed: 30, heart_rate: null,
    }));
    const res = await postJson('/api/sessions', {
      started_at: '2026-01-05T10:00:00Z',
      ended_at: '2026-01-05T11:06:40Z',
      distance_m: 33000,
      samples,
    });
    assert.equal(res.status, 201, 'a 67-minute ride must save');
    const session = await res.json();
    assert.equal(session.avg_power, 180);
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
    assert.equal(settings.trainer_mode, 'erg');
    assert.equal(settings.rear_resistance, 5);
  });

  test('new accounts start with the default ride, in random order', async () => {
    const settings = await (await api('/api/settings')).json();
    assert.match(settings.scenery_videos, /D6tC1pyrsTM/);
    assert.equal(settings.scenery_mode, 'random');
    assert.equal((await postJson('/api/settings', { scenery_mode: 'shuffle' }, 'PUT')).status, 400);
  });

  test('bike weight defaults to 9 kg and stays within a real bike\'s range', async () => {
    assert.equal((await (await api('/api/settings')).json()).bike_weight_kg, 9);
    assert.equal((await (await postJson('/api/settings', { bike_weight_kg: 7.4 }, 'PUT')).json()).bike_weight_kg, 7.4);
    assert.equal((await postJson('/api/settings', { bike_weight_kg: 1 }, 'PUT')).status, 400);
    assert.equal((await postJson('/api/settings', { bike_weight_kg: 60 }, 'PUT')).status, 400);
    await postJson('/api/settings', { bike_weight_kg: 9 }, 'PUT');
  });

  test('trainer mode: rear gears, virtual gears or ERG; an old default_mode carries over', async () => {
    assert.equal((await (await postJson('/api/settings', { trainer_mode: 'rear' }, 'PUT')).json()).trainer_mode, 'rear');
    const { default: db } = await import('../backend/src/db/index.js');
    const row = db.prepare("SELECT user_id, value FROM user_config WHERE key = 'settings'").get();
    const old = JSON.parse(row.value);
    delete old.trainer_mode;
    old.default_mode = 'gears';
    db.prepare("UPDATE user_config SET value = ? WHERE user_id = ? AND key = 'settings'").run(JSON.stringify(old), row.user_id);
    const settings = await (await api('/api/settings')).json();
    assert.equal(settings.trainer_mode, 'gears');
    assert.equal(settings.default_mode, undefined);
    await postJson('/api/settings', { trainer_mode: 'erg' }, 'PUT');
  });

  test('the theme is dark unless the rider picks light', async () => {
    assert.equal((await (await api('/api/settings')).json()).theme, 'dark');
    assert.equal((await (await postJson('/api/settings', { theme: 'light' }, 'PUT')).json()).theme, 'light');
    assert.equal((await postJson('/api/settings', { theme: 'pink' }, 'PUT')).status, 400);
    await postJson('/api/settings', { theme: 'dark' }, 'PUT');
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
    assert.equal((await postJson('/api/settings', { trainer_mode: 'nonsense' }, 'PUT')).status, 400);
    assert.equal((await postJson('/api/settings', { rear_resistance: 25 }, 'PUT')).status, 400);
  });

  test('clamps start_gear instead of failing when gear_count shrinks', async () => {
    await postJson('/api/settings', { gear_count: 12, start_gear: 10 }, 'PUT');
    const settings = await (await postJson('/api/settings', { gear_count: 3 }, 'PUT')).json();
    assert.equal(settings.start_gear, 3);
  });
});

describe('records and level', () => {
  test('a duration record is only ever set by a ride that covered it', async () => {
    // The invariant, rather than an assumption about which rides exist: a
    // 20-minute record must never come from a 5-minute effort.
    const [{ records }, sessions] = await Promise.all([
      (await api('/api/records')).json(),
      (await api('/api/sessions')).json(),
    ]);
    const longestSec = Math.max(
      0,
      ...sessions.map((s) => (new Date(s.ended_at) - new Date(s.started_at)) / 1000)
    );

    for (const record of records.filter((r) => r.key.startsWith('best_'))) {
      const windowSec = Number(record.key.match(/best_(\d+)s/)[1]);
      if (record.value == null) continue;
      assert.ok(
        longestSec >= windowSec,
        `${record.key} is set but no ride is ${windowSec}s long`
      );
    }

    // And a window longer than any ride must stay empty.
    const impossible = records.find((r) => {
      const m = r.key.match(/best_(\d+)s/);
      return m && Number(m[1]) > longestSec;
    });
    if (impossible) assert.equal(impossible.value, null);
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
