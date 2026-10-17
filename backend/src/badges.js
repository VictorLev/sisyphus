// Badges, computed from a rider's log on demand, like Feats and the level:
// nothing is stored, so they can never go stale and deleting a ride takes
// back whatever only it had earned. Each earned badge names the ride (or
// FTP change) that earned it; each locked one says how far along it is.
//
// computeBadges() is pure: the route gathers the data, this decides. Hidden
// badges stay "???" with a hint until earned.

const DAY_MS = 24 * 60 * 60 * 1000;

// The ride's local calendar date and hour, from its saved UTC offset (rides
// from before offsets were saved are read as UTC).
function localParts(startedAt, offsetMin) {
  const d = new Date(Date.parse(startedAt) + (offsetMin ?? 0) * 60_000);
  return {
    date: d.toISOString().slice(0, 10),
    dayNumber: Math.floor(d.getTime() / DAY_MS),
    hour: d.getUTCHours(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(), // 0 = Sunday
  };
}

const isoFromSqlite = (text) => `${String(text).replace(' ', 'T')}Z`;
const earnedOnRide = (ride) => ({ earned_at: ride.started_at, session_id: ride.id });
const earnedOnFtp = (row) => ({ earned_at: isoFromSqlite(row.created_at), session_id: row.session_id ?? null });

function prepare(data) {
  const workouts = new Map(data.workouts.map((w) => [w.id, w]));
  const rides = [...data.sessions]
    .sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : a.id - b.id))
    .map((s) => {
      const durationSec = Math.max(0, (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000) || 0;
      const stats = data.sampleStats[s.id];
      const workout = s.workout_id ? workouts.get(s.workout_id) : null;
      return {
        ...s,
        ...localParts(s.started_at, s.tz_offset_min),
        durationSec,
        km: (s.distance_m ?? 0) / 1000,
        coastSec: stats && stats.count > 0 ? (stats.zero / stats.count) * durationSec : 0,
        best20: data.best20[s.id] ?? null,
        ftpAtRide: s.ftp ?? data.currentFtp,
        // Ridden to the end: at least 98% of the workout's length.
        completed: Boolean(workout && durationSec >= workout.totalSec * 0.98),
        workout,
      };
    });
  return { rides, workouts: data.workouts, ftpHistory: data.ftpHistory };
}

// --- evaluators: each returns { earned } or { progress } -------------------

const count = (target) => ({ rides }) =>
  rides.length >= target ? { earned: earnedOnRide(rides[target - 1]) } : { progress: { value: rides.length, target } };

function cumulative(valueOf, target) {
  return ({ rides }) => {
    let total = 0;
    for (const ride of rides) {
      total += valueOf(ride);
      if (total >= target) return { earned: earnedOnRide(ride) };
    }
    return { progress: { value: Math.floor(total), target } };
  };
}

// One ride doing something. `best` (optional) reports the closest so far.
function oneRide(test, best = null, target = null) {
  return ({ rides }) => {
    const ride = rides.find(test);
    if (ride) return { earned: earnedOnRide(ride) };
    if (!best) return {};
    return { progress: { value: Math.floor(Math.max(0, ...rides.map(best))), target } };
  };
}

// Rides on consecutive local days; earned on the first ride of the day that
// completes the run.
function daysInARow(n, ridesOf = (ctx) => ctx.rides) {
  return (ctx) => {
    const firstOnDay = new Map();
    for (const ride of ridesOf(ctx)) if (!firstOnDay.has(ride.dayNumber)) firstOnDay.set(ride.dayNumber, ride);
    const days = [...firstOnDay.keys()].sort((a, b) => a - b);
    let run = 0;
    let bestRun = 0;
    for (let i = 0; i < days.length; i++) {
      run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
      bestRun = Math.max(bestRun, run);
      if (run >= n) return { earned: earnedOnRide(firstOnDay.get(days[i])) };
    }
    return { progress: { value: bestRun, target: n } };
  };
}

// `weeks` consecutive Monday-to-Sunday weeks with at least `perWeek` rides.
function weeksInARow(weeks, perWeek) {
  return ({ rides }) => {
    const counts = new Map();
    const qualified = []; // [weekStartDay, ride that made it qualify], in order
    for (const ride of rides) {
      const weekStart = ride.dayNumber - ((ride.weekday + 6) % 7);
      const n = (counts.get(weekStart) ?? 0) + 1;
      counts.set(weekStart, n);
      if (n === perWeek) qualified.push([weekStart, ride]);
    }
    qualified.sort((a, b) => a[0] - b[0]);
    let run = 0;
    let bestRun = 0;
    for (let i = 0; i < qualified.length; i++) {
      run = i > 0 && qualified[i][0] === qualified[i - 1][0] + 7 ? run + 1 : 1;
      bestRun = Math.max(bestRun, run);
      if (run >= weeks) return { earned: earnedOnRide(qualified[i][1]) };
    }
    return { progress: { value: bestRun, target: weeks } };
  };
}

// At least `days` different days within any `windowDays`-day span.
function daysWithin(days, windowDays) {
  return ({ rides }) => {
    const firstOnDay = new Map();
    for (const ride of rides) if (!firstOnDay.has(ride.dayNumber)) firstOnDay.set(ride.dayNumber, ride);
    const list = [...firstOnDay.keys()].sort((a, b) => a - b);
    let start = 0;
    let best = 0;
    for (let i = 0; i < list.length; i++) {
      while (list[i] - list[start] >= windowDays) start += 1;
      best = Math.max(best, i - start + 1);
      if (i - start + 1 >= days) return { earned: earnedOnRide(firstOnDay.get(list[i])) };
    }
    return { progress: { value: best, target: days } };
  };
}

// The same workout on `n` consecutive days.
function sameWorkoutDaysInARow(n) {
  return (ctx) => {
    const byWorkout = new Map();
    for (const ride of ctx.rides) {
      if (!ride.workout_id) continue;
      if (!byWorkout.has(ride.workout_id)) byWorkout.set(ride.workout_id, []);
      byWorkout.get(ride.workout_id).push(ride);
    }
    let winner = null;
    for (const rides of byWorkout.values()) {
      const result = daysInARow(n, () => rides)(ctx);
      if (result.earned && (!winner || result.earned.earned_at < winner.earned_at)) winner = result.earned;
    }
    return winner ? { earned: winner } : {};
  };
}

function ftpBaseline(history) {
  if (history.length === 0) return null;
  return history[0].previous_ftp ?? history[0].ftp;
}

const ftpUp = (fraction) => ({ ftpHistory }) => {
  const base = ftpBaseline(ftpHistory);
  if (base == null) return { progress: { value: 0, target: Math.round(fraction * 100) } };
  const row = ftpHistory.find((r) => r.ftp >= base * (1 + fraction));
  if (row) return { earned: earnedOnFtp(row) };
  const best = Math.max(...ftpHistory.map((r) => r.ftp));
  return { progress: { value: Math.max(0, Math.round(((best - base) / base) * 100)), target: Math.round(fraction * 100) } };
};

// --- the badges -------------------------------------------------------------

const H = 3600;
export const BADGES = [
  // Pushes
  { id: 'pushes-1', group: 'Pushes', tier: 'bronze', name: 'First Push', description: 'Finish your first ride.', unit: 'rides', evaluate: count(1) },
  { id: 'pushes-10', group: 'Pushes', tier: 'bronze', name: '10 Pushes', description: 'Ride 10 times.', unit: 'rides', evaluate: count(10) },
  { id: 'pushes-50', group: 'Pushes', tier: 'silver', name: '50 Pushes', description: 'Ride 50 times.', unit: 'rides', evaluate: count(50) },
  { id: 'pushes-100', group: 'Pushes', tier: 'gold', name: '100 Pushes', description: 'Ride 100 times.', unit: 'rides', evaluate: count(100) },
  { id: 'pushes-250', group: 'Pushes', tier: 'gold', name: 'The Boulder Knows You', description: 'Ride 250 times.', unit: 'rides', evaluate: count(250) },

  // Distance, all time
  { id: 'distance-100', group: 'Distance', tier: 'bronze', name: '100 km', description: 'Ride 100 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 100) },
  { id: 'distance-500', group: 'Distance', tier: 'silver', name: '500 km', description: 'Ride 500 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 500) },
  { id: 'distance-1000', group: 'Distance', tier: 'gold', name: '1,000 km', description: 'Ride 1,000 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 1000) },
  { id: 'distance-5000', group: 'Distance', tier: 'gold', name: '5,000 km', description: 'Ride 5,000 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 5000) },

  // Time, all time
  { id: 'time-10', group: 'Time', tier: 'bronze', name: '10 Hours', description: 'Ride 10 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 10) },
  { id: 'time-50', group: 'Time', tier: 'silver', name: '50 Hours', description: 'Ride 50 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 50) },
  { id: 'time-100', group: 'Time', tier: 'gold', name: '100 Hours', description: 'Ride 100 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 100) },
  { id: 'time-250', group: 'Time', tier: 'gold', name: '250 Hours', description: 'Ride 250 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 250) },

  // One big ride
  { id: 'ride-1h', group: 'Big Rides', tier: 'bronze', name: 'The Hour', description: 'Ride for an hour in one go.', unit: 'min', evaluate: oneRide((r) => r.durationSec >= H, (r) => r.durationSec / 60, 60) },
  { id: 'ride-2h', group: 'Big Rides', tier: 'silver', name: 'Two Hours', description: 'Ride for two hours in one go.', unit: 'min', evaluate: oneRide((r) => r.durationSec >= 2 * H, (r) => r.durationSec / 60, 120) },
  { id: 'ride-30km', group: 'Big Rides', tier: 'bronze', name: '30 km Ride', description: 'Ride 30 km in one go.', unit: 'km', evaluate: oneRide((r) => r.km >= 30, (r) => r.km, 30) },
  { id: 'ride-50km', group: 'Big Rides', tier: 'silver', name: '50 km Ride', description: 'Ride 50 km in one go.', unit: 'km', evaluate: oneRide((r) => r.km >= 50, (r) => r.km, 50) },
  { id: 'ride-100km', group: 'Big Rides', tier: 'gold', name: 'Century', description: 'Ride 100 km in one go.', unit: 'km', evaluate: oneRide((r) => r.km >= 100, (r) => r.km, 100) },

  // Consistency
  { id: 'streak-3', group: 'Consistency', tier: 'bronze', name: 'Three in a Row', description: 'Ride three days in a row.', unit: 'days', evaluate: daysInARow(3) },
  { id: 'streak-7', group: 'Consistency', tier: 'silver', name: 'Every Day', description: 'Ride seven days in a row. Push the boulder. Every day.', unit: 'days', evaluate: daysInARow(7) },
  { id: 'weeks-4', group: 'Consistency', tier: 'gold', name: 'Habit', description: 'Ride 3 times a week, four weeks in a row.', unit: 'weeks', evaluate: weeksInARow(4, 3) },

  // Power
  { id: 'peak-500', group: 'Power', tier: 'bronze', name: '500 W', description: 'Hit 500 W.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 500, (r) => r.max_power ?? 0, 500) },
  { id: 'peak-750', group: 'Power', tier: 'silver', name: '750 W', description: 'Hit 750 W.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 750, (r) => r.max_power ?? 0, 750) },
  { id: 'peak-1000', group: 'Power', tier: 'gold', name: '1,000 W', description: 'Hit 1,000 W.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 1000, (r) => r.max_power ?? 0, 1000) },
  { id: 'threshold', group: 'Power', tier: 'silver', name: 'At Threshold', description: 'Hold your FTP for 20 minutes.', evaluate: oneRide((r) => r.best20 != null && r.ftpAtRide > 0 && r.best20 >= r.ftpAtRide) },

  // FTP
  { id: 'ftp-tested', group: 'FTP', tier: 'bronze', name: 'Tested', description: 'Take an FTP test and keep the result.', evaluate: ({ ftpHistory }) => {
    const row = ftpHistory.find((r) => r.source === 'test');
    return row ? { earned: earnedOnFtp(row) } : {};
  } },
  { id: 'ftp-5', group: 'FTP', tier: 'silver', name: 'Stronger', description: 'Raise your FTP 5% above your first one.', unit: '%', evaluate: ftpUp(0.05) },
  { id: 'ftp-10', group: 'FTP', tier: 'gold', name: 'Much Stronger', description: 'Raise your FTP 10% above your first one.', unit: '%', evaluate: ftpUp(0.1) },

  // Workouts
  { id: 'finish-1', group: 'Workouts', tier: 'bronze', name: 'Finisher', description: 'Ride a workout to the end.', evaluate: oneRide((r) => r.completed) },
  { id: 'finish-10', group: 'Workouts', tier: 'silver', name: 'Ten Finished', description: 'Ride 10 workouts to the end.', unit: 'workouts', evaluate: cumulative((r) => (r.completed ? 1 : 0), 10) },
  { id: 'library-all', group: 'Workouts', tier: 'gold', name: 'Library Card', description: 'Ride every library workout to the end.', unit: 'workouts', evaluate: ({ rides, workouts }) => {
    const library = workouts.filter((w) => w.library && !w.test).map((w) => w.id);
    const done = new Set();
    for (const ride of rides) {
      if (ride.completed && ride.workout?.library) done.add(ride.workout_id);
      if (library.length > 0 && library.every((id) => done.has(id))) return { earned: earnedOnRide(ride) };
    }
    return { progress: { value: library.filter((id) => done.has(id)).length, target: library.length } };
  } },

  // Oddities: the funny ones, visible from the start
  { id: 'coffee-break', group: 'Oddities', tier: 'fun', name: 'Coffee Break', description: 'A ride under 5 minutes. That counts, right?', evaluate: oneRide((r) => r.durationSec >= 60 && r.durationSec < 300) },
  { id: 'freewheeler', group: 'Oddities', tier: 'fun', name: 'Freewheeler', description: '10 minutes of coasting in one ride.', evaluate: oneRide((r) => r.coastSec >= 600) },
  { id: 'spin-doctor', group: 'Oddities', tier: 'fun', name: 'Spin Doctor', description: 'Average 100+ rpm over a ride of 20 minutes or more.', evaluate: oneRide((r) => r.durationSec >= 1200 && r.avg_cadence >= 100) },
  { id: 'grinder', group: 'Oddities', tier: 'fun', name: 'The Grinder', description: 'Average 60 rpm or less over a ride of 20 minutes or more.', evaluate: oneRide((r) => r.durationSec >= 1200 && r.avg_cadence > 0 && r.avg_cadence <= 60) },
  { id: 'night-owl', group: 'Oddities', tier: 'fun', name: 'Night Owl', description: 'Start a ride between midnight and 4 am.', evaluate: oneRide((r) => r.hour < 4) },
  { id: 'early-bird', group: 'Oddities', tier: 'fun', name: 'Early Bird', description: 'Start a ride between 4 and 6 am.', evaluate: oneRide((r) => r.hour >= 4 && r.hour < 6) },

  // Secrets: "???" until earned
  { id: 'pi', group: 'Secrets', tier: 'secret', hidden: true, name: 'π', description: 'A ride of 3.14 km.', hint: 'Irrational, but round enough.', evaluate: oneRide((r) => r.km >= 3.14 && r.km < 3.15) },
  { id: 'wrong-sport', group: 'Secrets', tier: 'secret', hidden: true, name: 'Wrong Sport', description: 'Ride exactly a marathon: 42.195 km.', hint: 'Someone told you it was a run.', evaluate: oneRide((r) => r.km >= 42.195 && r.km < 42.4) },
  { id: 'christmas', group: 'Secrets', tier: 'secret', hidden: true, name: 'Christmas Push', description: 'Ride on Christmas Day.', hint: 'Somebody has a lot of chimneys to visit.', evaluate: oneRide((r) => r.month === 12 && r.day === 25) },
  { id: 'new-year', group: 'Secrets', tier: 'secret', hidden: true, name: 'New Year, Same Boulder', description: 'Ride on New Year’s Day.', hint: 'Resolutions, day one.', evaluate: oneRide((r) => r.month === 1 && r.day === 1) },
  { id: 'leap-day', group: 'Secrets', tier: 'secret', hidden: true, name: 'Leap Day', description: 'Ride on 29 February.', hint: 'Only every four years.', evaluate: oneRide((r) => r.month === 2 && r.day === 29) },
  { id: 'friday-13', group: 'Secrets', tier: 'secret', hidden: true, name: 'Friday the 13th', description: 'Ride on a Friday the 13th.', hint: 'Unlucky for some.', evaluate: oneRide((r) => r.weekday === 5 && r.day === 13) },
  { id: 'groundhog', group: 'Secrets', tier: 'secret', hidden: true, name: 'Groundhog Day', description: 'Ride the same workout five days in a row.', hint: 'Again. And again. And again.', evaluate: sameWorkoutDaysInARow(5) },
  { id: 'overachiever', group: 'Secrets', tier: 'secret', hidden: true, name: 'Overachiever', description: 'Hit three times your FTP.', hint: 'Briefly, a lot more than your best hour.', evaluate: oneRide((r) => r.ftpAtRide > 0 && r.max_power >= 3 * r.ftpAtRide) },
  { id: 'humbled', group: 'Secrets', tier: 'secret', hidden: true, name: 'Humbled', description: 'Keep an FTP test result that was lower than before. The boulder rolls back sometimes.', hint: 'Honesty is a kind of strength.', evaluate: ({ ftpHistory }) => {
    const row = ftpHistory.find((r) => r.source === 'test' && r.previous_ftp != null && r.ftp < r.previous_ftp);
    return row ? { earned: earnedOnFtp(row) } : {};
  } },
  { id: 'camus', group: 'Secrets', tier: 'secret', hidden: true, name: 'One Must Imagine Sisyphus Happy', description: 'Ride on 30 different days within 60 days.', hint: 'The struggle itself toward the heights is enough to fill a heart.', evaluate: daysWithin(30, 60) },
];

export function computeBadges(data) {
  const ctx = prepare(data);
  return BADGES.map((badge) => {
    const result = badge.evaluate(ctx);
    const earned = Boolean(result.earned);
    const secret = badge.hidden && !earned;
    return {
      id: badge.id,
      group: badge.group,
      tier: badge.tier,
      hidden: Boolean(badge.hidden),
      name: secret ? '???' : badge.name,
      description: secret ? badge.hint : badge.description,
      earned,
      earned_at: result.earned?.earned_at ?? null,
      session_id: result.earned?.session_id ?? null,
      progress: !earned && !secret && result.progress ? { ...result.progress, unit: badge.unit ?? null } : null,
    };
  });
}
