// A route's road, for riding it: where along it the rider is, the grade
// there, and which second of the video matches. Built from the route's
// points ({ d, alt }, metres along the road) and video points ({ d, t }).

const GRADE_WINDOW_M = 25; // grade measured over ±25 m: altitude data is noisy point to point
const MAX_GRADE = 20; // the trainer can't do more anyway, and spikes are usually bad data

// Value of `key` at distance d, interpolated between the points around it.
function interpolate(list, d, key) {
  if (d <= list[0].d) return list[0][key];
  const last = list[list.length - 1];
  if (d >= last.d) return last[key];
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = list[lo];
  const b = list[hi];
  return b.d > a.d ? a[key] + ((b[key] - a[key]) * (d - a.d)) / (b.d - a.d) : a[key];
}

export class RouteTrack {
  constructor({ points, video_points: videoPoints }) {
    this.points = points;
    this.videoPoints = videoPoints;
    this.distanceM = points[points.length - 1].d;
  }

  altitudeAt(d) {
    return interpolate(this.points, d, 'alt');
  }

  // Grade in %, over a window around d (shrunk at the ends of the road).
  gradeAt(distance) {
    const d = Math.max(0, Math.min(this.distanceM, distance));
    const from = Math.max(0, d - GRADE_WINDOW_M);
    const to = Math.min(this.distanceM, d + GRADE_WINDOW_M);
    if (to - from < 1) return 0;
    const grade = ((this.altitudeAt(to) - this.altitudeAt(from)) / (to - from)) * 100;
    return Math.max(-MAX_GRADE, Math.min(MAX_GRADE, Math.round(grade * 10) / 10));
  }

  // The second of video showing distance d.
  videoTimeAt(d) {
    return interpolate(this.videoPoints, d, 't');
  }

  // Seconds of video per metre of road around d: how fast the video must
  // play for each m/s the rider goes.
  videoSecondsPerMetre(d) {
    const ahead = Math.min(this.distanceM, d + 10);
    const behind = Math.max(0, ahead - 20);
    return ahead > behind ? (this.videoTimeAt(ahead) - this.videoTimeAt(behind)) / (ahead - behind) : 0;
  }

  // Every `step` metres, for drawing the profile.
  profile(samples = 200) {
    return Array.from({ length: samples }, (_, i) => this.altitudeAt((this.distanceM * i) / (samples - 1)));
  }
}
