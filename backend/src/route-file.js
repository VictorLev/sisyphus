// A route file: the road's profile and how the video lines up with it.
//
//   {
//     "geometry":     [{ "distance": 0, "altitude": 1.5, "latitude": -22.9, "longitude": -43.1 }, ...],
//     "video_points": [{ "distance": 0, "time": 0 }, ...]
//   }
//
// distance in metres along the road, altitude in metres, time in seconds
// into the video. Some exports add a line after the JSON (a checksum); only
// the first JSON value is read.

export class RouteFileError extends Error {}

function firstJsonValue(text) {
  const raw = String(text).replace(/^﻿/, '').trim();
  // Find where the first top-level value ends by counting brackets.
  let depth = 0;
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(0, i + 1));
    }
  }
  return JSON.parse(raw);
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

// The optional "metadata" block: names in both languages, where it is, and
// the author's own distance, climbing and riding time. Unknown keys are
// dropped, text is trimmed to 120 characters, and a missing or empty value
// is null. No block at all: null.
const META_TEXT = ['title_en', 'title_fr', 'city', 'country', 'continent'];
const META_NUMBERS = ['eta_min', 'distance_km', 'elevation_gain_m'];

function parseMetadata(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const out = {};
  for (const key of META_TEXT) {
    const value = typeof meta[key] === 'string' ? meta[key].trim().slice(0, 120) : '';
    out[key] = value || null;
  }
  for (const key of META_NUMBERS) {
    const value = Number(meta[key]);
    out[key] = meta[key] != null && meta[key] !== '' && Number.isFinite(value) && value >= 0 ? value : null;
  }
  return Object.values(out).some((v) => v != null) ? out : null;
}

// Parses and checks a route file (text or an already-parsed object).
// Returns { points, videoPoints, distanceM, ascentM, durationS, metadata }.
export function parseRouteFile(input) {
  let data;
  try {
    data = typeof input === 'string' ? firstJsonValue(input) : input;
  } catch {
    throw new RouteFileError('the route file is not valid JSON');
  }
  const geometry = data?.geometry;
  const video = data?.video_points;
  if (!Array.isArray(geometry) || geometry.length < 2) throw new RouteFileError('geometry needs at least 2 points');
  if (!Array.isArray(video) || video.length < 2) throw new RouteFileError('video_points needs at least 2 points');

  const points = geometry.map((p, i) => {
    if (!finite(p?.distance) || !finite(p?.altitude)) throw new RouteFileError(`geometry point ${i} needs a distance and an altitude`);
    const point = { d: p.distance, alt: p.altitude };
    if (finite(p.latitude) && finite(p.longitude)) Object.assign(point, { lat: p.latitude, lon: p.longitude });
    return point;
  });
  const videoPoints = video.map((p, i) => {
    if (!finite(p?.distance) || !finite(p?.time)) throw new RouteFileError(`video point ${i} needs a distance and a time`);
    return { d: p.distance, t: p.time };
  });
  for (const [list, name] of [[points, 'geometry'], [videoPoints, 'video_points']]) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].d < list[i - 1].d) throw new RouteFileError(`${name} distances must not go backwards (point ${i})`);
    }
  }
  for (let i = 1; i < videoPoints.length; i++) {
    if (videoPoints[i].t < videoPoints[i - 1].t) throw new RouteFileError(`video times must not go backwards (point ${i})`);
  }

  let ascentM = 0;
  for (let i = 1; i < points.length; i++) ascentM += Math.max(0, points[i].alt - points[i - 1].alt);
  return {
    points,
    videoPoints,
    distanceM: points.at(-1).d,
    ascentM: Math.round(ascentM),
    durationS: videoPoints.at(-1).t,
    metadata: parseMetadata(data.metadata),
  };
}
