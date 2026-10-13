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

  // A pause drops whatever the open window holds; resume() then shifts the
  // start forward by the paused time, so offsets count riding time only and
  // a break never looks like a stretch of the power curve.
  pause(nowMs) {
    this._window = [];
    this._pausedAtMs = nowMs;
  }

  resume(nowMs) {
    if (this._pausedAtMs == null) return;
    if (this.startedAtMs != null) this.startedAtMs += nowMs - this._pausedAtMs;
    this._pausedAtMs = null;
    this._window = [];
  }

  // Averages so far, by the same rule the server uses for the saved ride:
  // moving samples (cadence > 0) only, falling back to all samples, so the
  // live figures agree with the summary at the end.
  averagePower() {
    return this._movingMean('power');
  }

  averageSpeed() {
    return this._movingMean('speed');
  }

  _movingMean(field) {
    const withValue = this.samples.filter((s) => s[field] != null);
    const moving = withValue.filter((s) => s.cadence > 0);
    const pool = moving.length > 0 ? moving : withValue;
    if (pool.length === 0) return null;
    return pool.reduce((sum, s) => sum + s[field], 0) / pool.length;
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
