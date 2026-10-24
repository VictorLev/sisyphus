import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RouteTrack } from '../frontend/js/workout/route-track.js';

// 2 km: climbs 5% over the first km, then flat. Filmed at 10 m/s for the
// first km and 20 m/s for the second.
const track = new RouteTrack({
  points: [{ d: 0, alt: 0 }, { d: 1000, alt: 50 }, { d: 2000, alt: 50 }],
  video_points: [{ d: 0, t: 0 }, { d: 1000, t: 100 }, { d: 2000, t: 150 }],
});

test('altitude and grade along the road', () => {
  assert.equal(track.distanceM, 2000);
  assert.equal(track.altitudeAt(500), 25);
  assert.equal(track.gradeAt(500), 5);
  assert.equal(track.gradeAt(1500), 0);
  assert.equal(track.gradeAt(1000), 2.5, 'half climb, half flat across the top');
  assert.equal(track.gradeAt(-50), 5, 'clamped to the road');
});

test('a steep spike in the data is capped at 20%', () => {
  const spiky = new RouteTrack({ points: [{ d: 0, alt: 0 }, { d: 10, alt: 30 }, { d: 100, alt: 30 }], video_points: [{ d: 0, t: 0 }, { d: 100, t: 10 }] });
  assert.equal(spiky.gradeAt(5), 20);
});

test('which second of video shows where, and how fast to play it', () => {
  assert.equal(track.videoTimeAt(500), 50);
  assert.equal(track.videoTimeAt(1500), 125);
  assert.equal(track.videoTimeAt(5000), 150, 'past the end: the last frame');
  assert.equal(track.videoSecondsPerMetre(500), 0.1, 'filmed at 10 m/s: 0.1 s of video per metre');
  assert.equal(track.videoSecondsPerMetre(1500), 0.05);
});

test('a profile for drawing', () => {
  const p = track.profile(5);
  assert.deepEqual(p, [0, 25, 50, 50, 50]);
});
