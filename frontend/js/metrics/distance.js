// Tracks cumulative ride distance. Prefers the trainer's own Total Distance
// field (baselined at first observation, since some firmware doesn't start
// it at zero); falls back to trapezoidal integration of instantaneous speed
// over wall-clock time if the device never reports distance. The mode is
// decided once per session, from the first reading, and held for the rest
// of the session.
export class DistanceTracker {
  constructor() {
    this.mode = null; // 'device' | 'integrated'
    this.deviceBaselineM = null;
    this.integratedTotalM = 0;
    this.lastSpeedKmh = null;
    this.lastTimestampMs = null;
    this.currentTotalM = 0;
  }

  update(reading, nowMs) {
    if (this.mode === null) {
      this.mode = reading.totalDistanceM != null ? 'device' : 'integrated';
    }

    if (this.mode === 'device') {
      if (reading.totalDistanceM != null) {
        if (this.deviceBaselineM === null) {
          this.deviceBaselineM = reading.totalDistanceM;
        }
        this.currentTotalM = reading.totalDistanceM - this.deviceBaselineM;
      }
      // field absent on this particular reading: no update this tick
    } else {
      const speedKmh = reading.instantaneousSpeedKmh ?? 0;
      if (this.lastTimestampMs != null) {
        const dtSec = (nowMs - this.lastTimestampMs) / 1000;
        const avgSpeedMs = ((this.lastSpeedKmh ?? speedKmh) + speedKmh) / 2 / 3.6;
        this.integratedTotalM += avgSpeedMs * dtSec;
      }
      this.lastSpeedKmh = speedKmh;
      this.lastTimestampMs = nowMs;
      this.currentTotalM = this.integratedTotalM;
    }

    return this.currentTotalM;
  }

  reset() {
    this.mode = null;
    this.deviceBaselineM = null;
    this.integratedTotalM = 0;
    this.lastSpeedKmh = null;
    this.lastTimestampMs = null;
    this.currentTotalM = 0;
  }
}
