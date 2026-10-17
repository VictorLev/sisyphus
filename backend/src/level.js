// Levels: shared by the rider's own level (routes/level.js) and the
// leaderboard, so both always agree.

// XP is deliberately built from stable quantities — time and distance
// ridden — rather than training load. Load depends on FTP, so raising your
// FTP would retroactively shrink past rides and your level could go DOWN,
// which is the one thing a progression system must never do.
const XP_PER_MINUTE = 1;
const XP_PER_KM = 1;
const XP_PER_PUSH = 10; // finishing a ride at all is the point

// Cumulative XP required to reach a level: 100, 300, 600, 1000, 1500...
// Early levels arrive within a ride or two, later ones take real volume.
export const thresholdFor = (level) => (100 * (level - 1) * level) / 2;

export function levelFromXp(xp) {
  let level = 1;
  while (thresholdFor(level + 1) <= xp) level += 1;
  return level;
}

export function xpFor({ minutes, km, pushes }) {
  return Math.round(Math.max(0, minutes) * XP_PER_MINUTE + Math.max(0, km) * XP_PER_KM + pushes * XP_PER_PUSH);
}
