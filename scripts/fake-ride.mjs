// Generates a synthetic-but-believable ride through one of your workouts and
// saves it through the real API, so aggregates and records are computed by
// exactly the same code path as a genuine ride.
//
// Useful for filling the Chronicle while developing, checking how a long
// session renders, or exercising the save path without getting on the bike.
//
//   npm run fake-ride                       # the first workout in the library
//   npm run fake-ride -- "Aerobic 15's #1"  # a workout by name (or partial)
//   npm run fake-ride -- "Sweet Spot" 3     # ...ridden 3 days ago
//
// The server must be running. BASE overrides the URL.
const BASE = process.env.BASE || 'http://localhost:7479';
const [nameArg, daysAgoArg] = process.argv.slice(2);
const daysAgo = Number(daysAgoArg) || 1;

const workouts = await (await fetch(`${BASE}/api/workouts`)).json();
if (workouts.length === 0) throw new Error('no workouts to ride — build one first');

const workout = nameArg
  ? workouts.find((w) => w.name.toLowerCase().includes(nameArg.toLowerCase()))
  : workouts[0];
if (!workout) {
  throw new Error(
    `no workout matching "${nameArg}". Available:\n  ` +
    workouts.map((w) => w.name).join('\n  ')
  );
}
const WORKOUT_NAME = workout.name;

// Power-speed on the flat: P ≈ k·v³, calibrated so 200 W ≈ 32 km/h.
const speedKmhFor = (watts) => (watts <= 0 ? 0 : Math.cbrt(watts / 0.284) * 3.6);
const noise = (spread) => (Math.random() - 0.5) * 2 * spread;

const samples = [];
let power = 90;        // rolling into it
let t = 0;
let distanceM = 0;
let maxPower = 0;

for (const segment of workout.structure) {
  const target = segment.target_watts;
  const short = segment.duration_sec <= 20; // sprints are attacked, not settled into
  for (let i = 0; i < segment.duration_sec; i++) {
    // First-order approach to the target: legs do not step instantly. Short
    // efforts are hit harder and faster than long ones.
    const tau = short ? 0.55 : 0.28;
    power += (target - power) * tau;
    // Sprints overshoot at the start then sag as it bites.
    if (short) power += i < 3 ? target * 0.06 : -target * 0.015 * i;
    // Long steady blocks drift a little.
    power += noise(target * 0.045) + (segment.duration_sec > 120 ? Math.sin(t / 40) * target * 0.02 : 0);

    const watts = Math.max(0, Math.round(power));
    maxPower = Math.max(maxPower, watts);

    const cadence = Math.round(Math.min(105, Math.max(68, 78 + watts / 12 + noise(3))));
    const speed = Math.max(0, speedKmhFor(watts) + noise(0.6));
    distanceM += (speed / 3.6); // one second per sample

    samples.push({
      timestamp_offset_sec: t,
      power: watts,
      cadence,
      speed: Number(speed.toFixed(1)),
      heart_rate: null,
    });
    t += 1;
  }
}

// An evening ride, however many days back was asked for.
const start = new Date();
start.setDate(start.getDate() - daysAgo);
start.setHours(18, 30, 0, 0);
const end = new Date(start.getTime() + t * 1000);

const res = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workout_id: workout.id,
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    distance_m: Number(distanceM.toFixed(1)),
    max_power: maxPower,
    samples,
  }),
});
if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`);
const saved = await res.json();

console.log(`saved session ${saved.id} — synthetic data, delete it from the Chronicle when done`);
console.table([{
  workout: WORKOUT_NAME,
  duration: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`,
  samples: samples.length,
  km: (distanceM / 1000).toFixed(2),
  avg_power: Math.round(saved.avg_power),
  max_power: saved.max_power,
  avg_cadence: Math.round(saved.avg_cadence),
  avg_speed: saved.avg_speed.toFixed(1),
}]);
