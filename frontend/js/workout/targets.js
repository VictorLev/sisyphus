// Library workouts give each segment's target as a percentage of FTP
// (`target_ftp_pct`) so one workout fits every rider. Everything downstream —
// the runner, ERG, the live screen, the charts — works in watts, so the
// conversion happens once, at the edge: when a ride starts (with the rider's
// FTP then) and when a past ride's targets are drawn (with the FTP it was
// ridden at). Segments already in watts pass through untouched.

// The profile's default FTP, used if a rider has cleared theirs.
export const FALLBACK_FTP = 200;

export function resolveTargets(structure, ftp) {
  const base = ftp > 0 ? ftp : FALLBACK_FTP;
  return structure.map((segment) => {
    if (segment.target_ftp_pct == null) return segment;
    const { target_ftp_pct, ...rest } = segment;
    return { ...rest, target_watts: Math.round((target_ftp_pct / 100) * base) };
  });
}
