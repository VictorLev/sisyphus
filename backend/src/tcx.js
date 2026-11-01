// A ride as a TCX file, for uploading to Strava by hand (strava.com/upload)
// or any app that reads Garmin's format: one lap, one trackpoint per sample
// with power (Garmin's TPX extension), cadence, speed, cumulative distance
// and heart rate when there is one. No positions: it is an indoor ride. A
// ride on a route also gets the road's altitude at each point, so Strava
// shows its elevation.

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
const round = (n, digits = 0) => Number(n.toFixed(digits));

// Distance per sample from speed (km/h), scaled so the total matches the
// ride's own distance when it has one.
function cumulativeDistances(samples, totalM) {
  const out = [];
  let d = 0;
  samples.forEach((s, i) => {
    const prev = i > 0 ? samples[i - 1].timestamp_offset_sec : 0;
    const dt = Math.max(0, s.timestamp_offset_sec - prev);
    d += ((s.speed ?? 0) / 3.6) * dt;
    out.push(d);
  });
  const scale = totalM > 0 && d > 0 ? totalM / d : 1;
  return out.map((v) => v * scale);
}

// The road's altitude at distance d, between its points ({ d, alt }).
export function altitudeAlong(points) {
  return (d) => {
    if (d <= points[0].d) return points[0].alt;
    let lo = 0;
    let hi = points.length - 1;
    if (d >= points[hi].d) return points[hi].alt;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].d <= d) lo = mid;
      else hi = mid;
    }
    const a = points[lo];
    const b = points[hi];
    return b.d > a.d ? a.alt + ((b.alt - a.alt) * (d - a.d)) / (b.d - a.d) : a.alt;
  };
}

// altitudeAt(metres): the route's altitude there, for a ride on a route.
export function buildTcx(session, samples, { altitudeAt = null } = {}) {
  const start = Date.parse(session.started_at);
  const end = session.ended_at ? Date.parse(session.ended_at) : start;
  const totalSec = Math.max(0, (end - start) / 1000);
  const distances = cumulativeDistances(samples, session.distance_m ?? 0);
  const totalM = distances.at(-1) ?? session.distance_m ?? 0;
  // kJ of work is close to kcal burned (human efficiency ~24% cancels the
  // 4.184 kJ/kcal), the usual cycling estimate.
  const kcal = session.avg_power ? Math.round((session.avg_power * totalSec) / 1000) : 0;
  const iso = (ms) => new Date(ms).toISOString();

  const points = samples.map((s, i) => {
    const parts = [`<Time>${iso(start + s.timestamp_offset_sec * 1000)}</Time>`];
    if (altitudeAt) parts.push(`<AltitudeMeters>${round(altitudeAt(distances[i]), 1)}</AltitudeMeters>`);
    parts.push(`<DistanceMeters>${round(distances[i], 1)}</DistanceMeters>`);
    if (s.heart_rate > 0) parts.push(`<HeartRateBpm><Value>${Math.round(s.heart_rate)}</Value></HeartRateBpm>`);
    if (s.cadence != null) parts.push(`<Cadence>${Math.min(254, Math.max(0, Math.round(s.cadence)))}</Cadence>`);
    const ext = [];
    if (s.speed != null) ext.push(`<ns3:Speed>${round(s.speed / 3.6, 2)}</ns3:Speed>`);
    if (s.power != null) ext.push(`<ns3:Watts>${Math.max(0, Math.round(s.power))}</ns3:Watts>`);
    if (ext.length) parts.push(`<Extensions><ns3:TPX>${ext.join('')}</ns3:TPX></Extensions>`);
    return `<Trackpoint>${parts.join('')}</Trackpoint>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities>
<Activity Sport="Biking">
<Id>${iso(start)}</Id>
<Lap StartTime="${iso(start)}">
<TotalTimeSeconds>${round(totalSec, 1)}</TotalTimeSeconds>
<DistanceMeters>${round(totalM, 1)}</DistanceMeters>
<Calories>${kcal}</Calories>
<Intensity>Active</Intensity>
<TriggerMethod>Manual</TriggerMethod>
<Track>
${points.join('\n')}
</Track>
</Lap>
${session.description ? `<Notes>${escapeXml(session.description)}</Notes>\n` : ''}<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>${escapeXml('Sisyphus')}</Name></Creator>
</Activity>
</Activities>
</TrainingCenterDatabase>
`;
}
