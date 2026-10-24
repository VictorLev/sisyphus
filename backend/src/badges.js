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
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
    year: d.getUTCFullYear(),
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
  return {
    rides,
    workouts: data.workouts,
    // Routes that can be ridden: { id, distance_m, ascent_m }.
    routes: data.routes ?? [],
    // Minutes ridden per calendar month ("YYYY-MM"): this rider's and the
    // best of anyone's (Employee of the Month).
    monthTotals: data.monthTotals ?? {},
    ftpHistory: data.ftpHistory,
    // Minutes ridden per calendar year: this rider's and the best of anyone's.
    yearTotals: data.yearTotals ?? {},
    now: data.now ?? Date.now(),
  };
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

// The year's champion: the most time ridden of anyone, ties shared. Only
// awarded once the year is over everywhere (noon UTC on 1 January: the last
// time zone has finished 31 December), since the lead can change until then.
// During the year, progress is your minutes against the leader's.
const yearOver = (year) => Date.UTC(year + 1, 0, 1, 12);
const champion = (year) => ({ yearTotals, now }) => {
  const { mine = 0, best = 0 } = yearTotals[year] ?? {};
  if (now >= yearOver(year)) {
    if (mine > 0 && mine >= best) return { earned: { earned_at: new Date(yearOver(year)).toISOString(), session_id: null } };
    return {};
  }
  if (now < Date.UTC(year, 0, 1) - 14 * 3600_000) return {}; // not started anywhere yet
  return { progress: { value: Math.round(mine), target: Math.max(1, Math.round(best)) } };
};

// --- the badges -------------------------------------------------------------

// Employee of the Month: the most riding time of everyone in a calendar
// month, awarded at noon UTC on the 1st of the next. Returns the months won,
// oldest first.
const monthOver = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return Date.UTC(y, m, 1, 12); // m is 1-based, so this is the next month
};
const monthsWon = ({ monthTotals, now }) => Object.keys(monthTotals).sort()
  .filter((ym) => now >= monthOver(ym) && monthTotals[ym].mine > 0 && monthTotals[ym].mine >= monthTotals[ym].best);
const earnedAtMonthEnd = (ym) => ({ earned_at: new Date(monthOver(ym)).toISOString(), session_id: null });

function employee(times) {
  return (ctx) => {
    const won = monthsWon(ctx);
    if (won.length >= times) return { earned: earnedAtMonthEnd(won[times - 1]) };
    if (times > 1) return { progress: { value: won.length, target: times } };
    // During the month: your minutes against the leader's.
    const ym = new Date(ctx.now).toISOString().slice(0, 7);
    const { mine = 0, best = 0 } = ctx.monthTotals[ym] ?? {};
    return { progress: { value: Math.round(mine), target: Math.max(1, Math.round(best)) } };
  };
}

// The first ride that takes a calendar month past `minutes` of riding.
function monthMinutes(minutes) {
  return ({ rides }) => {
    const totals = new Map();
    let best = 0;
    for (const ride of rides) {
      const key = `${ride.year}-${ride.month}`;
      const total = (totals.get(key) ?? 0) + ride.durationSec / 60;
      totals.set(key, total);
      best = Math.max(best, total);
      if (total >= minutes) return { earned: earnedOnRide(ride) };
    }
    return { progress: { value: Math.floor(best), target: minutes } };
  };
}

// Rides that pass a test, counted; earned on the one that makes `target`.
const countWhere = (test, target) => cumulative((r) => (test(r) ? 1 : 0), target);

// Different local days passing a test (e.g. Mondays).
function distinctDays(test, target) {
  return ({ rides }) => {
    const days = new Set();
    for (const ride of rides) {
      if (!test(ride)) continue;
      days.add(ride.dayNumber);
      if (days.size >= target) return { earned: earnedOnRide(ride) };
    }
    return { progress: { value: days.size, target } };
  };
}

// Weekends ridden on both Saturday and Sunday.
function fullWeekends(target) {
  return ({ rides }) => {
    const weekends = new Map(); // Saturday's dayNumber -> Set of 6 / 0
    let full = 0;
    for (const ride of rides) {
      if (ride.weekday !== 6 && ride.weekday !== 0) continue;
      const saturday = ride.weekday === 6 ? ride.dayNumber : ride.dayNumber - 1;
      const days = weekends.get(saturday) ?? new Set();
      const before = days.size;
      days.add(ride.weekday);
      weekends.set(saturday, days);
      if (before === 1 && days.size === 2 && ++full >= target) return { earned: earnedOnRide(ride) };
    }
    return { progress: { value: full, target } };
  };
}

// The second ride of a local day.
function twoInADay({ rides }) {
  const seen = new Set();
  for (const ride of rides) {
    if (seen.has(ride.dayNumber)) return { earned: earnedOnRide(ride) };
    seen.add(ride.dayNumber);
  }
  return {};
}

// Workouts ridden to the end, counting each workout once.
function differentWorkoutsFinished(target) {
  return ({ rides }) => {
    const done = new Set();
    for (const ride of rides) {
      if (!ride.completed) continue;
      done.add(ride.workout_id);
      if (done.size >= target) return { earned: earnedOnRide(ride) };
    }
    return { progress: { value: done.size, target } };
  };
}

// Routes: a ride reaching (98% of) its route's end.
const routeOf = (ctx, ride) => ctx.routes.find((r) => r.id === ride.route_id);
const finishedRoute = (ctx, ride) => {
  const route = ride.route_id && routeOf(ctx, ride);
  return Boolean(route && ride.km * 1000 >= route.distance_m * 0.98);
};
const routeFinish = (test = () => true) => (ctx) => {
  const ride = ctx.rides.find((r) => finishedRoute(ctx, r) && test(routeOf(ctx, r)));
  return ride ? { earned: earnedOnRide(ride) } : {};
};
function everyRoute(ctx) {
  const ids = ctx.routes.map((r) => r.id);
  if (ids.length < 3) return { progress: { value: 0, target: 3 } }; // not much of a world yet
  const done = new Set();
  for (const ride of ctx.rides) {
    if (!finishedRoute(ctx, ride)) continue;
    done.add(ride.route_id);
    if (ids.every((id) => done.has(id))) return { earned: earnedOnRide(ride) };
  }
  return { progress: { value: ids.filter((id) => done.has(id)).length, target: ids.length } };
}

const H = 3600;
export const BADGES = [
  // Pushes
  { id: 'pushes-1', group: 'Pushes', tier: 'bronze', name: 'First Push', description: 'Finish your first ride.', unit: 'rides', evaluate: count(1) },
  { id: 'pushes-10', group: 'Pushes', tier: 'bronze', name: '10 Pushes', description: 'Ride 10 times.', unit: 'rides', evaluate: count(10) },
  { id: 'pushes-50', group: 'Pushes', tier: 'silver', name: '50 Pushes', description: 'Ride 50 times.', unit: 'rides', evaluate: count(50) },
  { id: 'pushes-100', group: 'Pushes', tier: 'gold', name: '100 Pushes', description: 'Ride 100 times.', unit: 'rides', evaluate: count(100) },
  { id: 'pushes-250', group: 'Pushes', tier: 'gold', name: 'The Boulder Knows You', description: 'Ride 250 times.', unit: 'rides', evaluate: count(250) },
  { id: 'pushes-25', group: 'Pushes', tier: 'bronze', name: '25 Pushes', description: 'Ride 25 times.', unit: 'rides', evaluate: count(25) },
  { id: 'pushes-500', group: 'Pushes', tier: 'gold', name: 'Half a Thousand', description: 'Ride 500 times.', unit: 'rides', evaluate: count(500) },
  { id: 'pushes-1000', group: 'Pushes', tier: 'gold', name: 'Myth', description: 'Ride 1,000 times. They will tell stories about you.', unit: 'rides', evaluate: count(1000) },

  // Distance, all time
  { id: 'distance-100', group: 'Distance', tier: 'bronze', name: '100 km', description: 'Ride 100 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 100) },
  { id: 'distance-500', group: 'Distance', tier: 'silver', name: '500 km', description: 'Ride 500 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 500) },
  { id: 'distance-1000', group: 'Distance', tier: 'gold', name: '1,000 km', description: 'Ride 1,000 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 1000) },
  { id: 'distance-5000', group: 'Distance', tier: 'gold', name: '5,000 km', description: 'Ride 5,000 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 5000) },
  { id: 'distance-250', group: 'Distance', tier: 'bronze', name: '250 km', description: 'Ride 250 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 250) },
  { id: 'distance-2500', group: 'Distance', tier: 'silver', name: '2,500 km', description: 'Ride 2,500 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 2500) },
  { id: 'distance-10000', group: 'Distance', tier: 'gold', name: '10,000 km', description: 'Ride 10,000 km in total.', unit: 'km', evaluate: cumulative((r) => r.km, 10000) },
  { id: 'distance-earth', group: 'Distance', tier: 'gold', name: 'Around the World', description: 'Ride 40,075 km in total: once around the equator.', unit: 'km', evaluate: cumulative((r) => r.km, 40075) },

  // Time, all time
  { id: 'time-10', group: 'Time', tier: 'bronze', name: '10 Hours', description: 'Ride 10 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 10) },
  { id: 'time-50', group: 'Time', tier: 'silver', name: '50 Hours', description: 'Ride 50 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 50) },
  { id: 'time-100', group: 'Time', tier: 'gold', name: '100 Hours', description: 'Ride 100 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 100) },
  { id: 'time-250', group: 'Time', tier: 'gold', name: '250 Hours', description: 'Ride 250 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 250) },
  { id: 'time-25', group: 'Time', tier: 'bronze', name: '25 Hours', description: 'Ride 25 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 25) },
  { id: 'time-500', group: 'Time', tier: 'gold', name: '500 Hours', description: 'Ride 500 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 500) },
  { id: 'time-1000', group: 'Time', tier: 'gold', name: '1,000 Hours', description: 'Ride 1,000 hours in total.', unit: 'h', evaluate: cumulative((r) => r.durationSec / H, 1000) },

  // One big ride
  { id: 'ride-1h', group: 'Big Rides', tier: 'bronze', name: 'The Hour', description: 'Ride for an hour in one go.', unit: 'min', evaluate: oneRide((r) => r.durationSec >= H, (r) => r.durationSec / 60, 60) },
  { id: 'ride-2h', group: 'Big Rides', tier: 'silver', name: 'Two Hours', description: 'Ride for two hours in one go.', unit: 'min', evaluate: oneRide((r) => r.durationSec >= 2 * H, (r) => r.durationSec / 60, 120) },
  { id: 'ride-30km', group: 'Big Rides', tier: 'bronze', name: '30 km Ride', description: 'Ride 30 km in one go.', unit: 'km', evaluate: oneRide((r) => r.km >= 30, (r) => r.km, 30) },
  { id: 'ride-50km', group: 'Big Rides', tier: 'silver', name: '50 km Ride', description: 'Ride 50 km in one go.', unit: 'km', evaluate: oneRide((r) => r.km >= 50, (r) => r.km, 50) },
  { id: 'ride-100km', group: 'Big Rides', tier: 'gold', name: 'Century', description: 'Ride 100 km in one go.', unit: 'km', evaluate: oneRide((r) => r.km >= 100, (r) => r.km, 100) },
  { id: 'ride-90min', group: 'Big Rides', tier: 'bronze', name: 'Ninety', description: 'Ride for 90 minutes in one go.', unit: 'min', evaluate: oneRide((r) => r.durationSec >= 1.5 * H, (r) => r.durationSec / 60, 90) },
  { id: 'ride-3h', group: 'Big Rides', tier: 'gold', name: 'Three Hours', description: 'Ride for three hours in one go.', unit: 'min', evaluate: oneRide((r) => r.durationSec >= 3 * H, (r) => r.durationSec / 60, 180) },
  { id: 'ride-75km', group: 'Big Rides', tier: 'silver', name: '75 km Ride', description: 'Ride 75 km in one go.', unit: 'km', evaluate: oneRide((r) => r.km >= 75, (r) => r.km, 75) },
  { id: 'ride-150km', group: 'Big Rides', tier: 'gold', name: 'Gran Fondo', description: 'Ride 150 km in one go.', unit: 'km', evaluate: oneRide((r) => r.km >= 150, (r) => r.km, 150) },

  // Consistency
  { id: 'streak-3', group: 'Consistency', tier: 'bronze', name: 'Three in a Row', description: 'Ride three days in a row.', unit: 'days', evaluate: daysInARow(3) },
  { id: 'streak-7', group: 'Consistency', tier: 'silver', name: 'Every Day', description: 'Ride seven days in a row. Push the boulder. Every day.', unit: 'days', evaluate: daysInARow(7) },
  { id: 'weeks-4', group: 'Consistency', tier: 'gold', name: 'Habit', description: 'Ride 3 times a week, four weeks in a row.', unit: 'weeks', evaluate: weeksInARow(4, 3) },
  { id: 'streak-14', group: 'Consistency', tier: 'gold', name: 'Fortnight', description: 'Ride 14 days in a row.', unit: 'days', evaluate: daysInARow(14) },
  { id: 'streak-30', group: 'Consistency', tier: 'gold', name: 'Unbroken', description: 'Ride 30 days in a row.', unit: 'days', evaluate: daysInARow(30) },
  { id: 'weeks-8', group: 'Consistency', tier: 'gold', name: 'Two Months Strong', description: 'Ride 3 times a week, eight weeks in a row.', unit: 'weeks', evaluate: weeksInARow(8, 3) },
  { id: 'weeks-12', group: 'Consistency', tier: 'silver', name: 'A Whole Season', description: 'Ride twice a week, twelve weeks in a row.', unit: 'weeks', evaluate: weeksInARow(12, 2) },
  { id: 'days-20-of-30', group: 'Consistency', tier: 'silver', name: 'Twenty Days', description: 'Ride on 20 different days within 30 days.', unit: 'days', evaluate: daysWithin(20, 30) },

  // Power
  { id: 'peak-500', group: 'Power', tier: 'bronze', name: '500 W', description: 'Hit 500 W.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 500, (r) => r.max_power ?? 0, 500) },
  { id: 'peak-750', group: 'Power', tier: 'silver', name: '750 W', description: 'Hit 750 W.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 750, (r) => r.max_power ?? 0, 750) },
  { id: 'peak-1000', group: 'Power', tier: 'gold', name: '1,000 W', description: 'Hit 1,000 W.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 1000, (r) => r.max_power ?? 0, 1000) },
  { id: 'threshold', group: 'Power', tier: 'silver', name: 'At Threshold', description: 'Hold your FTP for 20 minutes.', evaluate: oneRide((r) => r.best20 != null && r.ftpAtRide > 0 && r.best20 >= r.ftpAtRide) },
  { id: 'peak-300', group: 'Power', tier: 'bronze', name: '300 W', description: 'Hit 300 W.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 300, (r) => r.max_power ?? 0, 300) },
  { id: 'peak-1250', group: 'Power', tier: 'gold', name: '1,250 W', description: 'Hit 1,250 W.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 1250, (r) => r.max_power ?? 0, 1250) },
  { id: 'peak-1500', group: 'Power', tier: 'gold', name: '1,500 W', description: 'Hit 1,500 W. Sprinter.', unit: 'W', evaluate: oneRide((r) => r.max_power >= 1500, (r) => r.max_power ?? 0, 1500) },
  { id: 'avg-200', group: 'Power', tier: 'silver', name: 'Diesel', description: 'Average 200 W over a ride of 30 minutes or more.', unit: 'W', evaluate: oneRide((r) => r.durationSec >= 1800 && r.avg_power >= 200, (r) => (r.durationSec >= 1800 ? r.avg_power ?? 0 : 0), 200) },
  { id: 'avg-250', group: 'Power', tier: 'gold', name: 'Locomotive', description: 'Average 250 W over a ride of 30 minutes or more.', unit: 'W', evaluate: oneRide((r) => r.durationSec >= 1800 && r.avg_power >= 250, (r) => (r.durationSec >= 1800 ? r.avg_power ?? 0 : 0), 250) },
  { id: 'above-threshold', group: 'Power', tier: 'gold', name: 'Above Threshold', description: 'Hold 105% of your FTP for 20 minutes: time for a new test.', evaluate: oneRide((r) => r.best20 != null && r.ftpAtRide > 0 && r.best20 >= r.ftpAtRide * 1.05) },
  { id: 'speed-40', group: 'Power', tier: 'silver', name: 'Speed Demon', description: 'Average 40 km/h over a ride of 20 minutes or more.', unit: 'km/h', evaluate: oneRide((r) => r.durationSec >= 1200 && r.avg_speed >= 40, (r) => (r.durationSec >= 1200 ? r.avg_speed ?? 0 : 0), 40) },

  // FTP
  { id: 'ftp-tested', group: 'FTP', tier: 'bronze', name: 'Tested', description: 'Take an FTP test and keep the result.', evaluate: ({ ftpHistory }) => {
    const row = ftpHistory.find((r) => r.source === 'test');
    return row ? { earned: earnedOnFtp(row) } : {};
  } },
  { id: 'ftp-5', group: 'FTP', tier: 'silver', name: 'Stronger', description: 'Raise your FTP 5% above your first one.', unit: '%', evaluate: ftpUp(0.05) },
  { id: 'ftp-10', group: 'FTP', tier: 'gold', name: 'Much Stronger', description: 'Raise your FTP 10% above your first one.', unit: '%', evaluate: ftpUp(0.1) },
  { id: 'ftp-20', group: 'FTP', tier: 'gold', name: 'Transformed', description: 'Raise your FTP 20% above your first one.', unit: '%', evaluate: ftpUp(0.2) },
  { id: 'ftp-tests-3', group: 'FTP', tier: 'silver', name: 'Lab Rat', description: 'Take three FTP tests and keep their results.', unit: 'tests', evaluate: ({ ftpHistory }) => {
    const tests = ftpHistory.filter((r) => r.source === 'test');
    return tests.length >= 3 ? { earned: earnedOnFtp(tests[2]) } : { progress: { value: tests.length, target: 3 } };
  } },

  // Workouts
  { id: 'finish-1', group: 'Workouts', tier: 'bronze', name: 'Finisher', description: 'Ride a workout to the end.', evaluate: oneRide((r) => r.completed) },
  { id: 'finish-10', group: 'Workouts', tier: 'silver', name: 'Ten Finished', description: 'Ride 10 workouts to the end.', unit: 'workouts', evaluate: cumulative((r) => (r.completed ? 1 : 0), 10) },
  { id: 'finish-25', group: 'Workouts', tier: 'gold', name: 'Twenty-Five Finished', description: 'Ride 25 workouts to the end.', unit: 'workouts', evaluate: cumulative((r) => (r.completed ? 1 : 0), 25) },
  { id: 'finish-50', group: 'Workouts', tier: 'gold', name: 'Fifty Finished', description: 'Ride 50 workouts to the end.', unit: 'workouts', evaluate: cumulative((r) => (r.completed ? 1 : 0), 50) },
  { id: 'architect', group: 'Workouts', tier: 'bronze', name: 'Architect', description: 'Ride a workout you built yourself to the end.', evaluate: oneRide((r) => r.completed && !r.workout.library) },
  { id: 'variety-5', group: 'Workouts', tier: 'silver', name: 'Variety Pack', description: 'Ride 5 different workouts to the end.', unit: 'workouts', evaluate: differentWorkoutsFinished(5) },
  { id: 'library-all', group: 'Workouts', tier: 'gold', name: 'Library Card', description: 'Ride every library workout to the end.', unit: 'workouts', evaluate: ({ rides, workouts }) => {
    const library = workouts.filter((w) => w.library && !w.test).map((w) => w.id);
    const done = new Set();
    for (const ride of rides) {
      if (ride.completed && ride.workout?.library) done.add(ride.workout_id);
      if (library.length > 0 && library.every((id) => done.has(id))) return { earned: earnedOnRide(ride) };
    }
    return { progress: { value: library.filter((id) => done.has(id)).length, target: library.length } };
  } },

  // Champions: the year's most time ridden, across all riders
  ...[2026, 2027, 2028].map((year) => ({
    id: `champion-${year}`, group: 'Champions', tier: 'gold', name: `${year} Champion`,
    description: `Ride the most time of everyone in ${year}. Awarded when the year ends.`,
    unit: 'min', evaluate: champion(year),
  })),

  // Oddities: the funny ones, visible from the start
  // Routes: rides along a filmed road.
  { id: 'route-1', group: 'Routes', tier: 'bronze', name: 'Sightseer', description: 'Ride a route.', evaluate: oneRide((r) => r.route_id != null) },
  { id: 'route-finish', group: 'Routes', tier: 'bronze', name: 'End of the Road', description: 'Ride a route to its end.', evaluate: routeFinish() },
  { id: 'route-10', group: 'Routes', tier: 'silver', name: 'Tourist', description: 'Ride routes 10 times.', unit: 'rides', evaluate: countWhere((r) => r.route_id != null, 10) },
  { id: 'route-climber', group: 'Routes', tier: 'silver', name: 'Climber', description: 'Ride a route with 300 m or more of climbing to its end.', evaluate: routeFinish((route) => route.ascent_m >= 300) },
  { id: 'route-all', group: 'Routes', tier: 'gold', name: 'Globetrotter', description: 'Ride every route to its end (once there are at least three).', unit: 'routes', evaluate: everyRoute },

  // Workplace: the monthly race, and the hours you keep.
  { id: 'employee-month', group: 'Workplace', tier: 'gold', name: 'Employee of the Month', description: 'Ride the most time of everyone in a calendar month. Awarded when the month ends.', unit: 'min', evaluate: employee(1) },
  { id: 'employee-quarter', group: 'Workplace', tier: 'gold', name: 'Employee of the Quarter', description: 'Be Employee of the Month three times.', unit: 'months', evaluate: employee(3) },
  { id: 'overtime', group: 'Workplace', tier: 'silver', name: 'Overtime', description: 'Ride 10 hours in one calendar month.', unit: 'min', evaluate: monthMinutes(600) },
  { id: 'weekend-warrior', group: 'Workplace', tier: 'bronze', name: 'Weekend Warrior', description: 'Ride on both Saturday and Sunday of the same weekend, four weekends.', unit: 'weekends', evaluate: fullWeekends(4) },
  { id: 'night-shift', group: 'Workplace', tier: 'fun', name: 'Night Shift', description: 'Start 5 rides after 10 pm.', unit: 'rides', evaluate: countWhere((r) => r.hour >= 22, 5) },
  { id: 'lunch-break', group: 'Workplace', tier: 'fun', name: 'Lunch Break Hero', description: 'Start 10 rides on weekdays between 11:30 and 1:30.', unit: 'rides', evaluate: countWhere((r) => r.weekday >= 1 && r.weekday <= 5 && r.minuteOfDay >= 690 && r.minuteOfDay < 810, 10) },
  { id: 'mondays', group: 'Workplace', tier: 'fun', name: 'Case of the Mondays', description: 'Ride on 4 different Mondays.', unit: 'days', evaluate: distinctDays((r) => r.weekday === 1, 4) },

  { id: 'double-header', group: 'Oddities', tier: 'fun', name: 'Double Header', description: 'Ride twice in one day.', evaluate: twoInADay },
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
  { id: 'halloween', group: 'Secrets', tier: 'secret', hidden: true, name: 'Pumpkin Spin', description: 'Ride on Halloween.', hint: 'Something spooky in the pedals.', evaluate: oneRide((r) => r.month === 10 && r.day === 31) },
  { id: 'saint-jean', group: 'Secrets', tier: 'secret', hidden: true, name: 'Bonne Saint-Jean', description: 'Ride on 24 June, the Fête nationale du Québec.', hint: 'Fleurdelisé day.', evaluate: oneRide((r) => r.month === 6 && r.day === 24) },
  { id: 'canada-day', group: 'Secrets', tier: 'secret', hidden: true, name: 'True North', description: 'Ride on Canada Day.', hint: 'The first of July.', evaluate: oneRide((r) => r.month === 7 && r.day === 1) },
  { id: 'valentine', group: 'Secrets', tier: 'secret', hidden: true, name: 'Love Handles', description: 'Ride on Valentine’s Day.', hint: 'Roses are red, the boulder is grey.', evaluate: oneRide((r) => r.month === 2 && r.day === 14) },
  { id: 'dont-panic', group: 'Secrets', tier: 'secret', hidden: true, name: 'Don’t Panic', description: 'A ride of exactly 42 minutes.', hint: 'The answer, in minutes.', evaluate: oneRide((r) => Math.abs(r.durationSec - 42 * 60) <= 15) },
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
