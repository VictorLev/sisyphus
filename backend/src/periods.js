// Calendar periods in a rider's own time zone, for the leaderboard: "this
// week" is Monday 00:00 to the next Monday 00:00 where the viewer is, "this
// month" the 1st to the 1st. Returned as UTC instants, which is how rides'
// start times are stored.

const DAY_MS = 24 * 60 * 60 * 1000;

export function periodRange(period, tzOffsetMin = 0, now = Date.now()) {
  const shift = tzOffsetMin * 60_000;
  const local = new Date(now + shift); // read its UTC fields as local time
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  let start;
  let end;
  if (period === 'month') {
    start = Date.UTC(y, m, 1);
    end = Date.UTC(y, m + 1, 1);
  } else {
    const sinceMonday = (local.getUTCDay() + 6) % 7;
    start = Date.UTC(y, m, d - sinceMonday);
    end = start + 7 * DAY_MS;
  }
  return { from: new Date(start - shift).toISOString(), to: new Date(end - shift).toISOString() };
}
