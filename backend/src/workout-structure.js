// Validation and conversion for a workout's segment list. Shared by the
// workouts API and the built-in library loader, so a library entry is held
// to exactly the rules a rider's own workout is.
//
// A segment's target is either absolute (`target_watts`, what the builder
// writes) or relative (`target_ftp_pct`, what the library uses so one
// workout fits every rider). Exactly one of the two must be present.

export const MAX_FTP_PCT = 300;

export function validateStructure(structure) {
  if (!Array.isArray(structure) || structure.length === 0) {
    return 'structure must be a non-empty array';
  }
  for (const segment of structure) {
    if (
      typeof segment !== 'object' ||
      segment === null ||
      !Number.isInteger(segment.duration_sec) ||
      segment.duration_sec <= 0 ||
      typeof segment.label !== 'string'
    ) {
      return 'each segment requires integer duration_sec > 0 and a string label';
    }
    const hasWatts = segment.target_watts !== undefined;
    const hasPct = segment.target_ftp_pct !== undefined;
    if (hasWatts === hasPct) {
      return 'each segment requires exactly one of target_watts or target_ftp_pct';
    }
    if (hasWatts && (typeof segment.target_watts !== 'number' || segment.target_watts < 0)) {
      return 'target_watts must be a number >= 0';
    }
    if (hasPct && (
      typeof segment.target_ftp_pct !== 'number' ||
      !Number.isFinite(segment.target_ftp_pct) ||
      segment.target_ftp_pct < 0 ||
      segment.target_ftp_pct > MAX_FTP_PCT
    )) {
      return `target_ftp_pct must be between 0 and ${MAX_FTP_PCT}`;
    }
    // Optional terrain. Signed: positive climbs, negative descends. Older
    // workouts have no grade at all, which reads as flat.
    if (segment.grade_percent !== undefined) {
      if (typeof segment.grade_percent !== 'number' || !Number.isFinite(segment.grade_percent)) {
        return 'grade_percent must be a number';
      }
      if (segment.grade_percent < -20 || segment.grade_percent > 20) {
        return 'grade_percent must be between -20 and 20';
      }
    }
  }
  return null;
}

// Turns % FTP targets into watts for one rider. The same rule as the
// frontend's workout/targets.js, which applies it at ride start; here it is
// used to make a rider's editable copy of a library workout.
export function toWatts(structure, ftp) {
  return structure.map(({ target_ftp_pct, ...segment }) => (
    target_ftp_pct === undefined
      ? segment
      : { ...segment, target_watts: Math.round((target_ftp_pct / 100) * ftp) }
  ));
}
