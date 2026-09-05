// In-memory sample buffer for the ride currently in progress. No BLE/DOM
// deps — samples are handed to the backend as-is when the ride ends.
export class SessionRecorder {
  constructor() {
    this.startedAtMs = null;
    this.samples = [];
  }

  start(nowMs) {
    this.startedAtMs = nowMs;
    this.samples = [];
  }

  addSample({ power = null, cadence = null, speed = null, heartRate = null }, nowMs) {
    const timestampOffsetSec = this.startedAtMs != null ? (nowMs - this.startedAtMs) / 1000 : 0;
    this.samples.push({
      timestamp_offset_sec: timestampOffsetSec,
      power,
      cadence,
      speed,
      heart_rate: heartRate,
    });
  }

  getSamples() {
    return this.samples;
  }

  reset() {
    this.startedAtMs = null;
    this.samples = [];
  }
}
