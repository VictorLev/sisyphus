// In-memory sample buffer for the ride currently in progress. No BLE/DOM
// deps — samples are handed to the backend as-is when the ride ends.
//
// Every BLE notification is accumulated via addReading(); commitSample()
// then writes ONE row per recording interval holding the mean of that
// window. Snapshotting the latest reading on a timer instead would both
// duplicate readings (the trainer notifies out of phase with our clock)
// and drop short peaks entirely — measured at ~36% duplicated samples
// before this change. The true peak is tracked separately across every raw
// reading, so max power never depends on which instant we happened to
// sample.
export class SessionRecorder {
  constructor() {
    this.startedAtMs = null;
    this.samples = [];
    this.maxPower = null;
    this._window = [];
  }

  start(nowMs) {
    this.startedAtMs = nowMs;
    this.samples = [];
    this.maxPower = null;
    this._window = [];
  }

  // Called for each BLE notification.
  addReading({ power = null, cadence = null, speed = null, heartRate = null }) {
    this._window.push({ power, cadence, speed, heartRate });
    if (power != null && (this.maxPower === null || power > this.maxPower)) {
      this.maxPower = power;
    }
  }

  // Called once per recording interval.
  commitSample(nowMs) {
    const timestampOffsetSec = this.startedAtMs != null ? (nowMs - this.startedAtMs) / 1000 : 0;
    const mean = (field) => {
      const values = this._window.map((r) => r[field]).filter((v) => v != null);
      if (values.length === 0) return null;
      return values.reduce((a, b) => a + b, 0) / values.length;
    };

    // An empty window means no notification arrived — a real gap (the
    // trainer streams even at zero power), so record nulls rather than
    // repeating stale values. SQL AVG/MAX skip them.
    this.samples.push({
      timestamp_offset_sec: timestampOffsetSec,
      power: mean('power'),
      cadence: mean('cadence'),
      speed: mean('speed'),
      heart_rate: mean('heartRate'),
    });
    this._window = [];
  }

  getSamples() {
    return this.samples;
  }

  getMaxPower() {
    return this.maxPower;
  }

  reset() {
    this.startedAtMs = null;
    this.samples = [];
    this.maxPower = null;
    this._window = [];
  }
}
