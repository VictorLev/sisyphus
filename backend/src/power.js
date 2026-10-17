// Power analysis over a ride's samples, shared by Feats (records.js) and the
// FTP test estimate (routes/ftp.js) so both read a ride the same way.

// Best average power sustained over `windowSec`, via a sliding window over
// timestamps rather than sample counts — the recording interval is a
// setting, so N samples is not reliably N seconds.
export function bestAverage(samples, windowSec) {
  const points = samples.filter((s) => s.power != null);
  if (points.length < 2) return null;

  let best = null;
  let start = 0;
  let sum = 0;
  let count = 0;

  for (let end = 0; end < points.length; end++) {
    sum += points[end].power;
    count += 1;
    // Shrink from the left until the window fits.
    while (start < end && points[end].timestamp_offset_sec - points[start].timestamp_offset_sec > windowSec) {
      sum -= points[start].power;
      count -= 1;
      start += 1;
    }
    const span = points[end].timestamp_offset_sec - points[start].timestamp_offset_sec;
    // Only count a window that actually covers the duration; a 20-minute
    // record can't be set by a 5-minute ride.
    if (span >= windowSec * 0.95 && count > 1) {
      const avg = sum / count;
      if (best === null || avg > best) best = avg;
    }
  }
  return best;
}

// An FTP test's result: the best average over the test's window, scaled by
// its factor (a 20-minute test reads 95% of the best 20 minutes, the classic
// protocol's allowance for what a 20-minute effort holds above an hour).
// null when the ride never covered the window, e.g. a test ended early.
export function estimateFtp(samples, { window_sec, factor }) {
  const best = bestAverage(samples, window_sec);
  if (best == null) return null;
  return { best_average_w: Math.round(best), estimate_w: Math.round(best * factor) };
}
