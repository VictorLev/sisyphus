// Time-windowed rolling average — not sample-count-windowed, since BLE
// notification rate isn't guaranteed constant across devices/firmware.
export class RollingAverage {
  constructor(windowMs = 10000) {
    this.windowMs = windowMs;
    this.samples = []; // { t, v }, oldest first
  }

  push(value, timestampMs) {
    this.samples.push({ t: timestampMs, v: value });
    this._trim(timestampMs);
  }

  average() {
    if (this.samples.length === 0) return null;
    const sum = this.samples.reduce((acc, s) => acc + s.v, 0);
    return sum / this.samples.length;
  }

  reset() {
    this.samples = [];
  }

  _trim(nowMs) {
    const cutoff = nowMs - this.windowMs;
    let i = 0;
    while (i < this.samples.length && this.samples[i].t < cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
  }
}
