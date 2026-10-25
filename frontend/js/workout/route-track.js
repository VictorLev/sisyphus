// A route's road, for riding it: where along it the rider is, the grade
// there, and which second of the video matches. Built from the route's
// points ({ d, alt }, metres along the road) and video points ({ d, t }).

const GRADE_WINDOW_M = 25; // grade measured over ±25 m: altitude data is noisy point to point
const MAX_GRADE = 20; // the trainer can't do more anyway, and spikes are usually bad data
const SECTION_STEP_M = 100; // sections are found 100 m at a time
const SECTION_GRADE = 2; // 2% or more is a climb, -2% or less a descent
const SECTION_MIN_M = 500; // shorter bits are folded into a neighbour
const SECTION_MAX_M = { climb: 1000, flat: 5000, descent: 5000 }; // longer ones are cut up (a climb km by km)

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

  // The road cut into climbs, flats and descents, like a workout's steps:
  // [{ from, to, kind: 'climb' | 'flat' | 'descent', grade }], grade being
  // the section's average in %. Graded 100 m at a time; bits shorter than
  // SECTION_MIN_M join their longer neighbour, so a dip in a climb doesn't
  // split it; then climbs are cut into kilometres and the rest into 5 km.
  sections() {
    const kindOf = (grade) => (grade >= SECTION_GRADE ? 'climb' : grade <= -SECTION_GRADE ? 'descent' : 'flat');
    const gradeOf = (from, to) => (to > from ? ((this.altitudeAt(to) - this.altitudeAt(from)) / (to - from)) * 100 : 0);
    let runs = [];
    for (let from = 0; from < this.distanceM; from += SECTION_STEP_M) {
      const to = Math.min(this.distanceM, from + SECTION_STEP_M);
      const kind = kindOf(gradeOf(from, to));
      const last = runs[runs.length - 1];
      if (last?.kind === kind) last.to = to;
      else runs.push({ from, to, kind });
    }
    const join = () => {
      runs = runs.reduce((out, r) => {
        const last = out[out.length - 1];
        if (last?.kind === r.kind) last.to = r.to;
        else out.push({ ...r });
        return out;
      }, []);
    };
    for (;;) {
      let i = -1;
      runs.forEach((r, j) => {
        if (r.to - r.from < SECTION_MIN_M && (i === -1 || r.to - r.from < runs[i].to - runs[i].from)) i = j;
      });
      if (i === -1 || runs.length === 1) break;
      const prev = runs[i - 1];
      const next = runs[i + 1];
      const into = !next || (prev && prev.to - prev.from >= next.to - next.from) ? i - 1 : i + 1;
      const a = Math.min(i, into);
      const merged = { from: runs[a].from, to: runs[a + 1].to };
      merged.kind = kindOf(gradeOf(merged.from, merged.to));
      runs.splice(a, 2, merged);
      join();
    }
    // Long sections in equal pieces, each with its own grade.
    return runs.flatMap((r) => {
      const n = Math.ceil((r.to - r.from) / SECTION_MAX_M[r.kind] - 1e-9);
      const len = (r.to - r.from) / n;
      return Array.from({ length: n }, (_, k) => {
        const from = r.from + k * len;
        const to = k === n - 1 ? r.to : from + len;
        return { from, to, kind: r.kind, grade: Math.round(gradeOf(from, to) * 10) / 10 };
      });
    });
  }

  // Every `step` metres, for drawing the profile.
  profile(samples = 200) {
    return Array.from({ length: samples }, (_, i) => this.altitudeAt((this.distanceM * i) / (samples - 1)));
  }
}
