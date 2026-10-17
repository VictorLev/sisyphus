import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTargets, FALLBACK_FTP } from '../frontend/js/workout/targets.js';
import { toWatts, validateStructure } from '../backend/src/workout-structure.js';
import { WorkoutRunner } from '../frontend/js/workout/runner.js';

const library = JSON.parse(readFileSync(new URL('../backend/src/db/library.json', import.meta.url), 'utf8'));

describe('% FTP targets', () => {
  test('convert to watts at the given FTP, rounded', () => {
    const out = resolveTargets([
      { duration_sec: 60, target_ftp_pct: 90, label: 'SS' },
      { duration_sec: 30, target_ftp_pct: 125, label: 'On', grade_percent: 3 },
    ], 247);
    assert.deepEqual(out, [
      { duration_sec: 60, target_watts: 222, label: 'SS' },
      { duration_sec: 30, target_watts: 309, label: 'On', grade_percent: 3 },
    ]);
  });

  test('leave watt targets exactly as typed', () => {
    const seg = { duration_sec: 60, target_watts: 173, label: 'Mine' };
    assert.equal(resolveTargets([seg], 300)[0], seg);
  });

  test('fall back to the default FTP when none is set', () => {
    const [seg] = resolveTargets([{ duration_sec: 60, target_ftp_pct: 50, label: 'x' }], null);
    assert.equal(seg.target_watts, FALLBACK_FTP / 2);
  });

  test('the backend copy of the rule gives the same watts as the frontend', () => {
    // "Copy to my workouts" converts on the server, a ride converts in the
    // browser; a rider must get the same numbers either way.
    for (const ftp of [150, 213, 280, 333]) {
      for (const workout of library) {
        assert.deepEqual(toWatts(workout.structure, ftp), resolveTargets(workout.structure, ftp), workout.key);
      }
    }
  });
});

describe('the built-in library', () => {
  test('has 10-15 valid workouts with unique keys, all in % FTP', () => {
    assert.ok(library.length >= 10 && library.length <= 15, `${library.length} workouts`);
    assert.equal(new Set(library.map((w) => w.key)).size, library.length);
    for (const workout of library) {
      assert.equal(validateStructure(workout.structure), null, workout.key);
      assert.ok(workout.structure.every((s) => s.target_watts === undefined && s.target_ftp_pct > 0), workout.key);
    }
  });

  test('covers recovery through a ramp test, with some short options', () => {
    const minutes = (w) => w.structure.reduce((sum, s) => sum + s.duration_sec, 0) / 60;
    const peak = (w) => Math.max(...w.structure.map((s) => s.target_ftp_pct));
    assert.ok(library.some((w) => peak(w) <= 55), 'a recovery ride');
    assert.ok(library.some((w) => peak(w) >= 110 && peak(w) <= 130), 'VO2max work');
    assert.ok(library.some((w) => /ramp/i.test(w.name)), 'a ramp test');
    assert.ok(library.filter((w) => minutes(w) <= 30).length >= 2, 'short sessions');
  });

  test('every workout runs start to finish once resolved', () => {
    for (const workout of library) {
      const runner = new WorkoutRunner(resolveTargets(workout.structure, 250));
      runner.start(0);
      const state = runner.tick(runner.totalDurationSec * 1000 + 1);
      assert.equal(state.isComplete, true, workout.key);
      assert.ok(runner.segments.every((s) => Number.isInteger(s.target_watts)), workout.key);
    }
  });
});
