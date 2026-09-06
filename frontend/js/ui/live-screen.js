import { ZONES, zoneForWatts } from '../zones.js';

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

  const targetEl = document.getElementById('ride-target');
  const segmentLabelEl = document.getElementById('segment-label-value');
  const segmentTargetEl = document.getElementById('segment-target-value');
  const segmentTargetLabelEl = document.getElementById('segment-target-label');
  const segmentRemainingEl = document.getElementById('segment-remaining-value');
  const gradeFigureEl = document.getElementById('segment-grade-figure');
  const gradeValueEl = document.getElementById('segment-grade-value');
  const gradeLabelEl = document.getElementById('segment-grade-label');

  const timelineEl = document.getElementById('segment-timeline');
  const stepsListEl = document.getElementById('steps-list');
  const stepsTitleEl = document.getElementById('steps-title');
  const stepsProgressEl = document.getElementById('steps-progress');

  const zonePanelEl = document.getElementById('ride-zone-panel');
  const zoneNameEl = document.getElementById('zone-name');
  const zoneLabelEl = document.getElementById('zone-label');
  const zoneBadgeEl = document.getElementById('zone-badge');
  const zoneScaleEl = document.getElementById('zone-scale');
  const elapsedEl = document.getElementById('ride-elapsed');
  const levelEl = document.getElementById('ride-level');

  document.getElementById('end-ride-btn').addEventListener('click', () => onEndRide());

  let timelineSegments = [];
  let riderFtp = null;
  let currentZoneId = null;
  // The step list is a window onto the workout, not the whole thing: a
  // 34-segment session would otherwise need a scrollbar the rider can't
  // use mid-effort. Show what they're on plus what's coming.
  const STEP_WINDOW = 5;
  let allSegments = [];
  let renderedFrom = null;

  // The zone ladder is static; only which cell is lit changes.
  for (const zone of ZONES) {
    const cell = document.createElement('span');
    cell.textContent = zone.name;
    cell.style.setProperty('--zone-color', zone.color);
    zoneScaleEl.appendChild(cell);
  }

  function setFtp(ftp) {
    riderFtp = ftp > 0 ? ftp : null;
  }

  function targetLabel(watts) {
    if (!riderFtp) return 'target watts';
    return `${Math.round((watts / riderFtp) * 100)}% FTP`;
  }

  // Zone comes from live smoothed power, so it reflects what the rider is
  // actually doing rather than what the workout asked for. Returns the zone
  // only when it changes, so callers can react without re-triggering.
  function updateZone(smoothedPower) {
    const zone = smoothedPower != null && riderFtp
      ? zoneForWatts(smoothedPower, riderFtp)
      : null;
    const id = zone?.id ?? null;
    if (id === currentZoneId) return null;
    currentZoneId = id;

    zoneNameEl.textContent = zone ? zone.name : '--';
    zoneLabelEl.textContent = zone ? zone.label : riderFtp ? 'Coasting' : 'Set an FTP';
    const color = zone ? zone.color : '#3a3632';
    zoneBadgeEl.style.setProperty('--zone-color', color);
    zonePanelEl.style.setProperty('--zone-color', color);
    [...zoneScaleEl.children].forEach((cell, i) => {
      cell.classList.toggle('is-active', zone ? ZONES[i].id === zone.id : false);
    });
    return zone;
  }

  function updateRawNumbers({ powerSmoothed, cadence, speed }) {
    powerEl.textContent = powerSmoothed != null ? Math.round(powerSmoothed) : '--';
    cadenceEl.textContent = cadence != null ? Math.round(cadence) : '--';
    speedEl.textContent = speed != null ? speed.toFixed(1) : '--';
    return updateZone(powerSmoothed);
  }

  function setLevel(level) {
    levelEl.textContent = `Lv ${level}`;
  }

  function setElapsed(seconds) {
    elapsedEl.textContent = formatTime(seconds);
  }

  // Builds the full timeline once per ride; the step list is drawn as a
  // moving window (see renderSteps).
  function buildTimeline(segments, workoutName) {
    stepsTitleEl.textContent = workoutName || 'Free Ride';
    timelineEl.innerHTML = '';
    stepsListEl.innerHTML = '';
    timelineSegments = [];
    allSegments = segments ?? [];
    renderedFrom = null;

    if (!segments || segments.length === 0) {
      timelineEl.hidden = true;
      stepsProgressEl.textContent = '';
      stepsListEl.innerHTML = '<li class="is-done">No steps — just ride.</li>';
      return;
    }

    segments.forEach((segment, index) => {
      const zone = zoneForWatts(segment.target_watts, riderFtp);

      const cell = document.createElement('div');
      cell.className = 'timeline-seg';
      cell.style.flex = `${segment.duration_sec} 0 0`;
      cell.style.background = zone.color;
      cell.style.opacity = '0.35';
      const fill = document.createElement('div');
      fill.className = 'timeline-fill';
      fill.style.background = zone.color;
      cell.appendChild(fill);
      timelineEl.appendChild(cell);
      timelineSegments.push({ cell, fill });
    });
    timelineEl.hidden = false;
    renderSteps(0);
  }

  function stepDuration(segment) {
    return segment.duration_sec >= 60
      ? `${Math.round(segment.duration_sec / 60)} min`
      : `${segment.duration_sec} sec`;
  }

  // Redraws the window of upcoming steps. Only called when the current
  // segment changes, so the list is not rebuilt every animation frame.
  function renderSteps(fromIndex) {
    renderedFrom = fromIndex;
    stepsListEl.innerHTML = '';
    const slice = allSegments.slice(fromIndex, fromIndex + STEP_WINDOW);

    slice.forEach((segment, offset) => {
      const index = fromIndex + offset;
      const zone = zoneForWatts(segment.target_watts, riderFtp);
      const li = document.createElement('li');
      li.style.setProperty('--zone-color', zone.color);
      if (offset === 0) li.classList.add('is-current');

      const watts = document.createElement('span');
      watts.className = 'step-watts';
      watts.textContent = `${segment.target_watts} W`;
      const time = document.createElement('span');
      time.className = 'step-time';
      const grade = segment.grade_percent ?? 0;
      time.textContent = (grade ? `${grade > 0 ? '▲' : '▼'}${Math.abs(grade)}%  ` : '') + stepDuration(segment);
      li.appendChild(watts);
      li.appendChild(time);
      li.title = segment.label || `Segment ${index + 1}`;
      stepsListEl.appendChild(li);
    });

    // Say how much is out of view rather than silently truncating.
    const remaining = allSegments.length - (fromIndex + slice.length);
    if (remaining > 0) {
      const more = document.createElement('li');
      more.className = 'steps-more';
      more.textContent = `+${remaining} more`;
      stepsListEl.appendChild(more);
    }
  }

  function updateTimeline(runnerState) {
    timelineSegments.forEach((entry, index) => {
      const done = runnerState.isComplete || index < runnerState.segmentIndex;
      const current = !runnerState.isComplete && index === runnerState.segmentIndex;
      entry.cell.classList.toggle('is-current', current);
      entry.cell.style.opacity = done ? '1' : current ? '0.85' : '0.35';
      const fraction = done ? 1 : current ? runnerState.progressFraction : 0;
      entry.fill.style.width = `${fraction * 100}%`;
    });

    // Slide the window forward as segments complete.
    const from = Math.min(runnerState.segmentIndex, Math.max(0, allSegments.length - 1));
    if (allSegments.length && from !== renderedFrom) renderSteps(from);

    stepsProgressEl.textContent = runnerState.isComplete
      ? 'done'
      : `${runnerState.segmentIndex + 1}/${runnerState.segments.length}`;
  }

  function updateWorkoutInfo(runnerState) {
    if (!runnerState) {
      targetEl.hidden = true;
      timelineEl.hidden = true;
      return;
    }

    updateTimeline(runnerState);

    if (runnerState.isComplete) {
      targetEl.hidden = false;
      segmentLabelEl.textContent = 'PUSH COMPLETE';
      segmentTargetEl.textContent = '--';
      segmentTargetLabelEl.textContent = 'target watts';
      segmentRemainingEl.textContent = '0:00';
      gradeFigureEl.hidden = true;
      return;
    }
    if (!runnerState.currentSegment) {
      targetEl.hidden = true;
      return;
    }

    const segment = runnerState.currentSegment;
    targetEl.hidden = false;
    segmentLabelEl.textContent = segment.label || `Segment ${runnerState.segmentIndex + 1}`;
    segmentTargetEl.textContent = segment.target_watts;
    segmentTargetLabelEl.textContent = targetLabel(segment.target_watts);
    segmentRemainingEl.textContent = formatTime(runnerState.remainingInSegmentSec);

    const grade = segment.grade_percent ?? 0;
    gradeFigureEl.hidden = grade === 0;
    if (grade !== 0) {
      gradeValueEl.textContent = `${grade > 0 ? '▲' : '▼'}${Math.abs(grade)}%`;
      gradeLabelEl.textContent = grade > 0 ? 'climbing' : 'descending';
    }
  }

  updateWorkoutInfo(null);
  updateZone(null);

  return { updateRawNumbers, updateWorkoutInfo, buildTimeline, setFtp, setLevel, setElapsed };
}
