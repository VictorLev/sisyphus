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
  const segmentTargetLabelEl = document.getElementById('segment-target-label');
  const timelineEl = document.getElementById('segment-timeline');
  const endRideBtn = document.getElementById('end-ride-btn');

  endRideBtn.addEventListener('click', () => onEndRide());

  let timelineSegments = [];
  let riderFtp = null; // when set, targets are annotated with %FTP

  function setFtp(ftp) {
    riderFtp = ftp > 0 ? ftp : null;
  }

  function targetLabel(watts) {
    if (!riderFtp) return 'target watts';
    return `target watts · ${Math.round((watts / riderFtp) * 100)}% FTP`;
  }

  function updateRawNumbers({ powerSmoothed, cadence, speed }) {
    powerEl.textContent = powerSmoothed != null ? Math.round(powerSmoothed) : '--';
    cadenceEl.textContent = cadence != null ? Math.round(cadence) : '--';
    speedEl.textContent = speed != null ? speed.toFixed(1) : '--';
  }

  // Builds the whole-workout bar once per ride: one cell per segment, width
  // proportional to its duration, so the shape of the session is visible at
  // a glance and the current position within it is obvious.
  function buildTimeline(segments) {
    timelineEl.innerHTML = '';
    timelineSegments = [];
    if (!segments || segments.length === 0) {
      timelineEl.hidden = true;
      return;
    }
    for (const segment of segments) {
      const cell = document.createElement('div');
      cell.className = 'timeline-seg';
      cell.style.flex = `${segment.duration_sec} 0 0`;

      const fill = document.createElement('div');
      fill.className = 'timeline-fill';
      cell.appendChild(fill);

      const watts = document.createElement('span');
      watts.className = 'timeline-watts';
      watts.textContent = `${segment.target_watts}`;
      cell.appendChild(watts);

      timelineEl.appendChild(cell);
      timelineSegments.push({ cell, fill });
    }
    timelineEl.hidden = false;
  }

  function updateTimeline(runnerState) {
    timelineSegments.forEach((entry, index) => {
      const done = runnerState.isComplete || index < runnerState.segmentIndex;
      const current = !runnerState.isComplete && index === runnerState.segmentIndex;
      entry.cell.classList.toggle('is-done', done);
      entry.cell.classList.toggle('is-current', current);
      // Completed segments read as full; the active one fills as it runs.
      const fraction = done ? 1 : current ? runnerState.progressFraction : 0;
      entry.fill.style.width = `${fraction * 100}%`;
    });
  }

  function updateWorkoutInfo(runnerState) {
    // Free ride (no runner): no segment panel or timeline at all.
    if (!runnerState) {
      segmentInfoEl.hidden = true;
      timelineEl.hidden = true;
      return;
    }

    updateTimeline(runnerState);

    // Workout finished: hold a completion state rather than blanking out —
    // the boulder is at the summit and the panel says so.
    if (runnerState.isComplete) {
      segmentInfoEl.hidden = false;
      segmentLabelEl.textContent = 'PUSH COMPLETE';
      segmentTargetEl.textContent = '--';
      segmentTargetLabelEl.textContent = 'target watts';
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
    segmentTargetLabelEl.textContent = targetLabel(runnerState.currentSegment.target_watts);
    segmentRemainingEl.textContent = formatTime(runnerState.remainingInSegmentSec);
  }

  updateWorkoutInfo(null);

  return { updateRawNumbers, updateWorkoutInfo, buildTimeline, setFtp };
}
