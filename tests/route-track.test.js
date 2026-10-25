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

test('sections: climbs, flats and descents, like a workout\'s steps', () => {
  assert.deepEqual(track.sections(), [
    { from: 0, to: 1000, kind: 'climb', grade: 5 },
    { from: 1000, to: 2000, kind: 'flat', grade: 0 },
  ]);
});

test('a short dip doesn\'t split a climb, and long sections are cut up', () => {
  // 3 km up at 6% with a 200 m flat in the middle, then 12 km flat.
  const road = new RouteTrack({
    points: [{ d: 0, alt: 0 }, { d: 1400, alt: 84 }, { d: 1600, alt: 84 }, { d: 3000, alt: 168 }, { d: 15000, alt: 168 }],
    video_points: [{ d: 0, t: 0 }, { d: 15000, t: 1500 }],
  });
  const s = road.sections();
  assert.deepEqual(s.map((x) => x.kind), ['climb', 'climb', 'climb', 'flat', 'flat', 'flat']);
  assert.deepEqual(s.map((x) => x.to - x.from), [1000, 1000, 1000, 4000, 4000, 4000], 'a climb km by km, a flat at most 5 km at a time');
  assert.deepEqual(s.map((x) => x.grade), [6, 4.8, 6, 0, 0, 0], 'each piece has its own grade');
  assert.equal(s.at(-1).to, 15000);
});
