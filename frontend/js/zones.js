// Power zones as percentages of FTP. Standard Coggan-style bands, matching
// the ranges shown by mainstream trainer apps so a workout written here
// means the same thing elsewhere.
//
// The colours are a heat progression through the app's palette — stone,
// slate, bronze, gold, ember, rust — rather than the neon green/red other
// apps use. Zone colour is functional (intensity must be distinguishable at
// a glance), but it should not fight the rest of the interface.
export const ZONES = [
  { id: 1, name: 'Z1', label: 'Recovery',   min: 0,    max: 0.55, color: '#5b544c' },
  { id: 2, name: 'Z2', label: 'Endurance',  min: 0.55, max: 0.75, color: '#6d7f8a' },
  { id: 3, name: 'Z3', label: 'Tempo',      min: 0.75, max: 0.90, color: '#b08d57' },
  { id: 4, name: 'Z4', label: 'Threshold',  min: 0.90, max: 1.05, color: '#e0c088' },
  { id: 5, name: 'Z5', label: 'VO2 Max',    min: 1.05, max: 1.20, color: '#d0854a' },
  { id: 6, name: 'Z6', label: 'Anaerobic',  min: 1.20, max: Infinity, color: '#b4533c' },
];

export function zoneForWatts(watts, ftp) {
  if (!ftp || ftp <= 0) return ZONES[2]; // no FTP set: treat everything as mid
  const fraction = watts / ftp;
  return ZONES.find((z) => fraction < z.max) ?? ZONES[ZONES.length - 1];
}

// A representative wattage for a zone — its midpoint, so a quick-add lands
// in the middle of the band rather than on a boundary. Z6 is open-ended, so
// it gets a sensible fixed offset above its floor.
export function wattsForZone(zone, ftp) {
  if (!ftp || ftp <= 0) return 150;
  const top = Number.isFinite(zone.max) ? zone.max : zone.min + 0.25;
  return Math.round(ftp * ((zone.min + top) / 2));
}

export function zoneRangeLabel(zone) {
  if (!Number.isFinite(zone.max)) return `>${Math.round(zone.min * 100)}%`;
  if (zone.min === 0) return `<${Math.round(zone.max * 100)}%`;
  return `${Math.round(zone.min * 100)}–${Math.round(zone.max * 100)}%`;
}

// Approximate training load for a planned workout, same basis as the
// Chronicle's weekly figure: not TrainingPeaks TSS, which needs normalised
// power we cannot know in advance.
export function estimatedLoad(segments, ftp) {
  if (!ftp || ftp <= 0) return null;
  return Math.round(
    segments.reduce((sum, seg) => {
      const hours = seg.duration_sec / 3600;
      const intensity = seg.target_watts / ftp;
      return sum + hours * intensity * intensity * 100;
    }, 0)
  );
}
