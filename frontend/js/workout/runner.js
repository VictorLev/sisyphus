// Segment state machine for running a structured workout. Pure logic, no
// DOM/BLE deps — ticked externally (from app.js's single rAF loop) via
// tick(nowMs), using a real elapsed delta rather than a fixed step, so the
// boulder motif gets smooth sub-second motion and there's no drift.
//
// No pause/failure states, per the spec: workouts are additive and
// informational only, not enforced.
export class WorkoutRunner extends EventTarget {
  constructor(segments) {
    super();
    this.segments = segments;
    this.totalDurationSec = segments.reduce((sum, s) => sum + s.duration_sec, 0);
    this.segmentIndex = 0;
    this.elapsedInSegmentSec = 0;
    this.totalElapsedSec = 0;
    this.isRunning = false;
    this.isComplete = false;
    this._lastTickMs = null;
  }

  start(nowMs) {
    this.isRunning = true;
    this.isComplete = false;
    this._lastTickMs = nowMs;
  }

  stop() {
    this.isRunning = false;
    this._lastTickMs = null;
  }

  tick(nowMs) {
    if (this.isRunning && this._lastTickMs != null) {
      const dtSec = (nowMs - this._lastTickMs) / 1000;
      this._lastTickMs = nowMs;
      this._advance(dtSec);
    }
    return this.state;
  }

  _advance(dtSec) {
    this.elapsedInSegmentSec += dtSec;
    this.totalElapsedSec += dtSec;

    while (
      !this.isComplete &&
      this.segmentIndex < this.segments.length &&
      this.elapsedInSegmentSec >= this.segments[this.segmentIndex].duration_sec
    ) {
      this.elapsedInSegmentSec -= this.segments[this.segmentIndex].duration_sec;
      this.segmentIndex += 1;

      if (this.segmentIndex >= this.segments.length) {
        this.isComplete = true;
        this.isRunning = false;
        this.elapsedInSegmentSec = 0;
        this.dispatchEvent(new CustomEvent('complete'));
      } else {
        this.dispatchEvent(new CustomEvent('segment-change', { detail: { segmentIndex: this.segmentIndex } }));
      }
    }
  }

  get state() {
    const currentSegment = this.segments[this.segmentIndex] ?? null;
    const nextSegment = this.segments[this.segmentIndex + 1] ?? null;
    const remainingInSegmentSec = currentSegment
      ? Math.max(0, currentSegment.duration_sec - this.elapsedInSegmentSec)
      : 0;

    return {
      segments: this.segments,
      segmentIndex: this.segmentIndex,
      elapsedInSegmentSec: this.elapsedInSegmentSec,
      remainingInSegmentSec,
      totalElapsedSec: this.totalElapsedSec,
      totalDurationSec: this.totalDurationSec,
      progressFraction: currentSegment ? Math.min(1, this.elapsedInSegmentSec / currentSegment.duration_sec) : 0,
      overallProgressFraction: this.totalDurationSec > 0 ? Math.min(1, this.totalElapsedSec / this.totalDurationSec) : 0,
      currentSegment,
      nextSegment,
      isRunning: this.isRunning,
      isComplete: this.isComplete,
    };
  }
}
