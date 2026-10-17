// Rides that could not be saved.
//
// A ride exists only in memory until the POST succeeds, so a server that is
// down, restarting, or on a port the page no longer knows about used to mean
// the ride was simply lost. For a permanent training log that is the worst
// possible failure, and the rider cannot re-pedal the hour.
//
// Failed saves are parked in localStorage instead and retried on the next
// load. localStorage is per-origin and survives reloads and crashes, which
// covers every case except closing the browser on a different origin.
//
// Each parked ride remembers which rider it belongs to, so a ride can never
// be retried into someone else's log on a shared machine. Rides parked
// before accounts existed carry no rider; they can only come from the
// original single-user install and are saved for whoever logs in first.

const KEY = 'sisyphus.pendingRides';
// An hour at 1 Hz is ~3600 samples; a handful of those stays well inside the
// ~5 MB budget, and silently growing forever would be worse than dropping the
// oldest.
const MAX_PENDING = 10;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // corrupt or unavailable storage must not break the app
  }
}

function write(rides) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rides.slice(-MAX_PENDING)));
    return true;
  } catch {
    // Quota exceeded, or storage disabled (private window).
    return false;
  }
}

const belongsTo = (ride, userId) => ride.userId == null || ride.userId === userId;

export function stashRide(payload, userId = null) {
  const rides = read();
  rides.push({ savedAt: new Date().toISOString(), userId, payload });
  return write(rides);
}

export function pendingCount(userId = null) {
  return read().filter((ride) => belongsTo(ride, userId)).length;
}

// Tries to save every parked ride. Whatever succeeds is removed; whatever
// fails stays for next time, so a retry can never lose a ride.
export async function flushPending(createSession, userId = null) {
  const rides = read();
  if (rides.length === 0) return { saved: 0, remaining: 0 };

  const stillPending = [];
  let saved = 0;
  for (const ride of rides) {
    // Another rider's ride stays parked for them.
    if (!belongsTo(ride, userId)) {
      stillPending.push(ride);
      continue;
    }
    try {
      await createSession(ride.payload);
      saved += 1;
    } catch {
      stillPending.push(ride);
    }
  }
  write(stillPending);
  return { saved, remaining: stillPending.filter((ride) => belongsTo(ride, userId)).length };
}
