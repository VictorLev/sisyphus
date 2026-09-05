function formatTime(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function initLiveScreen({ onEndRide }) {
  const powerEl = document.getElementById('power-value');
  const cadenceEl = document.getElementById('cadence-value');
  const speedEl = document.getElementById('speed-value');
  const segmentInfoEl = document.getElementById('segment-info');
  const segmentLabelEl = document.getElementById('segment-label-value');
  const segmentTargetEl = document.getElementById('segment-target-value');
  const segmentRemainingEl = document.getElementById('segment-remaining-value');
  const endRideBtn = document.getElementById('end-ride-btn');

  endRideBtn.addEventListener('click', () => onEndRide());

  function updateRawNumbers({ powerSmoothed, cadence, speed }) {
    powerEl.textContent = powerSmoothed != null ? Math.round(powerSmoothed) : '--';
    cadenceEl.textContent = cadence != null ? Math.round(cadence) : '--';
    speedEl.textContent = speed != null ? speed.toFixed(1) : '--';
  }

  function updateWorkoutInfo(runnerState) {
    // Free ride (no runner): no segment panel at all.
    if (!runnerState) {
      segmentInfoEl.hidden = true;
      return;
    }
    // Workout finished: hold a completion state rather than blanking out —
    // the boulder is at the summit and the panel says so.
    if (runnerState.isComplete) {
      segmentInfoEl.hidden = false;
      segmentLabelEl.textContent = 'PUSH COMPLETE';
      segmentTargetEl.textContent = '--';
      segmentRemainingEl.textContent = '0:00';
      return;
    }
    if (!runnerState.currentSegment) {
      segmentInfoEl.hidden = true;
      return;
    }
    segmentInfoEl.hidden = false;
    segmentLabelEl.textContent = runnerState.currentSegment.label || `Segment ${runnerState.segmentIndex + 1}`;
    segmentTargetEl.textContent = runnerState.currentSegment.target_watts;
    segmentRemainingEl.textContent = formatTime(runnerState.remainingInSegmentSec);
  }

  updateWorkoutInfo(null);

  return { updateRawNumbers, updateWorkoutInfo };
}
