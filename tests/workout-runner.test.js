import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkoutRunner } from '../frontend/js/workout/runner.js';

const segments = () => [
  { duration_sec: 5, target_watts: 100, label: 'A' },
  { duration_sec: 5, target_watts: 200, label: 'B' },
  { duration_sec: 5, target_watts: 150, label: 'C' },
];

describe('WorkoutRunner', () => {
  test('tracks progress within a segment', () => {
    const r = new WorkoutRunner(segments());
    r.start(0);
    r.tick(2500);
    assert.equal(r.state.segmentIndex, 0);
    assert.equal(r.state.progressFraction, 0.5);
    assert.equal(r.state.remainingInSegmentSec, 2.5);
  });

  test('advances at a boundary and carries the remainder', () => {
    const r = new WorkoutRunner(segments());
    r.start(0);
    r.tick(6000); // 1s into segment B
    assert.equal(r.state.segmentIndex, 1);
    assert.equal(r.state.currentSegment.label, 'B');
    assert.equal(r.state.elapsedInSegmentSec, 1);
  });

  test('a single large tick can cross several boundaries', () => {
    // rAF stalls (background tab, GC pause) must not lose segments.
    const r = new WorkoutRunner(segments());
    const seen = [];
    r.addEventListener('segment-change', (e) => seen.push(e.detail.segmentIndex));
    r.start(0);
    r.tick(12000);
    assert.deepEqual(seen, [1, 2]);
    assert.equal(r.state.segmentIndex, 2);
  });

  test('completes exactly at total duration and stops', () => {
    const r = new WorkoutRunner(segments());
    let completed = 0;
    r.addEventListener('complete', () => { completed += 1; });
    r.start(0);
    r.tick(15000);
    assert.equal(r.state.isComplete, true);
    assert.equal(r.state.isRunning, false);
    assert.equal(r.state.currentSegment, null);
    assert.equal(completed, 1);
  });

  test('completion fires once, not on every subsequent tick', () => {
    const r = new WorkoutRunner(segments());
    let completed = 0;
    r.addEventListener('complete', () => { completed += 1; });
    r.start(0);
    r.tick(15000);
    r.tick(20000);
    r.tick(30000);
    assert.equal(completed, 1);
  });

  test('overall progress spans the whole workout', () => {
    const r = new WorkoutRunner(segments());
    r.start(0);
    r.tick(7500); // half of 15s
    assert.equal(r.state.overallProgressFraction, 0.5);
  });

  test('exposes the next segment for look-ahead', () => {
    const r = new WorkoutRunner(segments());
    r.start(0);
    assert.equal(r.state.nextSegment.label, 'B');
  });

  test('ticking before start does not advance', () => {
    const r = new WorkoutRunner(segments());
    r.tick(5000);
    assert.equal(r.state.totalElapsedSec, 0);
  });

  test('progressFraction never exceeds 1', () => {
    const r = new WorkoutRunner([{ duration_sec: 5, target_watts: 100, label: 'A' }]);
    r.start(0);
    r.tick(4999);
    assert.ok(r.state.progressFraction <= 1);
  });
});
