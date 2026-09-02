// In-memory sample buffer for the ride currently in progress. No BLE/DOM
// deps. markLap() sets a flag consumed by the *next* addSample() call
// rather than writing a sample itself, so a lap always lands on a real
// recorded sample instead of being lost between the fixed recording ticks.
export class SessionRecorder {
  constructor() {
    this.startedAtMs = null;
    this.samples = [];
    this._pendingLap = false;
  }

  start(nowMs) {
    this.startedAtMs = nowMs;
    this.samples = [];
    this._pendingLap = false;
  }

  addSample({ power = null, cadence = null, speed = null, heartRate = null }, nowMs) {
    const timestampOffsetSec = this.startedAtMs != null ? (nowMs - this.startedAtMs) / 1000 : 0;
    this.samples.push({
      timestamp_offset_sec: timestampOffsetSec,
      power,
      cadence,
      speed,
      heart_rate: heartRate,
      lap_marker: this._pendingLap ? 1 : 0,
    });
    this._pendingLap = false;
  }

  markLap() {
    this._pendingLap = true;
  }

  getSamples() {
    return this.samples;
  }

  reset() {
    this.startedAtMs = null;
    this.samples = [];
    this._pendingLap = false;
  }
}
