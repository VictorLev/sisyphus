import { ZONES, zoneForWatts } from '../zones.js';
import { t, num, label as translateLabel } from '../i18n.js';

// A segment's label in the current language when it is one of the common
// ones (library workouts use them), as typed otherwise.
const segmentLabel = (label, index) => (label ? translateLabel(label) : t('live.segmentN', { n: index + 1 }));

function formatTime(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function initLiveScreen({ onPause, onResume, onEndRide, onDiscardRide }) {
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

  // Pause pop-up, in three steps: Paused (Continue / End / Cancel), then
  // End (save or not) or Cancel (confirm the discard). Every way out of a
  // ride is a deliberate second click.
  const pauseDialog = document.getElementById('pause-dialog');
  const steps = {
    paused: document.getElementById('pause-step-paused'),
    end: document.getElementById('pause-step-end'),
    cancel: document.getElementById('pause-step-cancel'),
  };
  let currentStep = 'paused';
  // Set when the dialog opened straight on End (the footer's End Ride): the
  // rider never asked to pause, so Back resumes the ride instead of
  // stopping at the Paused step.
  let backResumes = false;

  function showPauseStep(name) {
    currentStep = name;
    for (const [key, el] of Object.entries(steps)) el.hidden = key !== name;
    for (const btn of pauseDialog.querySelectorAll('.pause-back')) {
      btn.textContent = t(backResumes ? 'pause.keepRiding' : 'common.back');
    }
    // Land on the safe choice, so a second press of Space or Enter never
    // ends or discards the ride by accident.
    const focusId = { paused: 'pause-continue-btn', end: 'pause-end-back-btn', cancel: 'pause-cancel-back-btn' }[name];
    document.getElementById(focusId).focus();
  }

  // stats: { distanceM, avgPowerW, timeLeftSec, elapsedSec }. A workout
  // shows the time left; a free ride has no end, so it shows time ridden.
  function showPauseDialog({ distanceM, avgPowerW, timeLeftSec, elapsedSec }, { confirmEnd = false } = {}) {
    if (pauseDialog.open) return;
    document.getElementById('pause-distance').textContent =
      distanceM != null ? `${num(distanceM / 1000, 2)} km` : '--';
    document.getElementById('pause-avg-power').textContent =
      avgPowerW != null ? `${Math.round(avgPowerW)} W` : '--';
    const hasEnd = timeLeftSec != null;
    document.getElementById('pause-time-label').textContent = t(hasEnd ? 'pause.timeLeft' : 'pause.ridden');
    document.getElementById('pause-time').textContent = formatTime(hasEnd ? timeLeftSec : elapsedSec);
    pauseDialog.showModal();
    backResumes = confirmEnd;
    showPauseStep(confirmEnd ? 'end' : 'paused');
  }

  function back() {
    if (backResumes) resume();
    else showPauseStep('paused');
  }

  function resume() {
    pauseDialog.close();
    onResume();
  }

  function finish(callback) {
    pauseDialog.close();
    callback();
  }

  document.getElementById('pause-btn').addEventListener('click', () => onPause());
  document.getElementById('end-ride-btn').addEventListener('click', () => onPause({ confirmEnd: true }));
  document.getElementById('pause-continue-btn').addEventListener('click', resume);
  for (const [buttonId, step] of [['pause-end-btn', 'end'], ['pause-cancel-btn', 'cancel']]) {
    document.getElementById(buttonId).addEventListener('click', () => {
      backResumes = false; // came from Paused, so Back returns there
      showPauseStep(step);
    });
  }
  document.getElementById('pause-end-back-btn').addEventListener('click', back);
  document.getElementById('pause-cancel-back-btn').addEventListener('click', back);
  document.getElementById('pause-save-btn').addEventListener('click', () => finish(onEndRide));
  document.getElementById('pause-nosave-btn').addEventListener('click', () => finish(onDiscardRide));
  document.getElementById('pause-discard-btn').addEventListener('click', () => finish(onDiscardRide));
  // Escape steps back rather than slipping out of the dialog unhandled:
  // from End or Cancel it acts as Back, and from Paused it continues.
  pauseDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (currentStep === 'paused') resume();
    else back();
  });

  let timelineSegments = [];
  let nowLineEl = null;
  let riderFtp = null;
  let currentZoneId = null;
  // The step list is a window onto the workout, not the whole thing: a
  // 34-segment session would otherwise need a scrollbar the rider can't
  // use mid-effort. Show what they're on plus what's coming; twelve fills
  // the column on a 1080p screen without scrolling.
  const STEP_WINDOW = 12;
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
    if (!riderFtp) return t('live.targetWatts');
    return t('unit.pctFtp', { n: Math.round((watts / riderFtp) * 100) });
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
    zoneLabelEl.textContent = zone ? t(`zone.${zone.id}`) : t(riderFtp ? 'live.coasting' : 'live.setFtp');
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

  // Ride-so-far figures in the zone column; null shows as "--".
  function setTotals({ avgPowerW, avgSpeedKmh, distanceM }) {
    document.getElementById('total-avg-power').textContent =
      avgPowerW != null ? `${Math.round(avgPowerW)} W` : '--';
    document.getElementById('total-avg-speed').textContent =
      avgSpeedKmh != null ? `${avgSpeedKmh.toFixed(1)} km/h` : '--';
    document.getElementById('total-distance').textContent =
      distanceM != null ? `${(distanceM / 1000).toFixed(2)} km` : '--';
  }

  function setElapsed(seconds) {
    elapsedEl.textContent = formatTime(seconds);
  }

  // Builds the full timeline once per ride; the step list is drawn as a
  // moving window (see renderSteps).
  function buildTimeline(segments, workoutName) {
    stepsTitleEl.textContent = workoutName || t('home.freeRide');
    timelineEl.innerHTML = '';
    stepsListEl.innerHTML = '';
    timelineSegments = [];
    allSegments = segments ?? [];
    renderedFrom = null;

    if (!segments || segments.length === 0) {
      timelineEl.hidden = true;
      stepsProgressEl.textContent = '';
      stepsListEl.innerHTML = '';
      const none = document.createElement('li');
      none.className = 'is-done';
      none.textContent = t('live.noSteps');
      stepsListEl.appendChild(none);
      return;
    }

    // Drawn as a graph: bar height runs from the workout's lowest target
    // (a 20% stub, so it stays visible) to its highest (full height).
    const watts = segments.map((s) => s.target_watts);
    const minW = Math.min(...watts);
    const spanW = Math.max(...watts) - minW;
    segments.forEach((segment, index) => {
      const zone = zoneForWatts(segment.target_watts, riderFtp);

      const cell = document.createElement('div');
      cell.className = 'timeline-seg';
      cell.style.flex = `${segment.duration_sec} 0 0`;
      const level = spanW > 0 ? (segment.target_watts - minW) / spanW : 1;
      cell.style.height = `${20 + level * 80}%`;
      // The bar itself is a faint tint and the fill is the solid zone
      // colour, so progress through a bar stands out instead of hiding in
      // a small opacity change.
      cell.style.background = `color-mix(in srgb, ${zone.color} 35%, transparent)`;
      const fill = document.createElement('div');
      fill.className = 'timeline-fill';
      fill.style.background = zone.color;
      cell.appendChild(fill);
      const label = document.createElement('span');
      label.className = 'timeline-watts';
      label.textContent = `${segment.target_watts}W`;
      cell.appendChild(label);
      timelineEl.appendChild(cell);
      timelineSegments.push({ cell, fill });
    });
    nowLineEl = document.createElement('div');
    nowLineEl.className = 'timeline-now';
    timelineEl.appendChild(nowLineEl);
    timelineEl.hidden = false;
    fitTimelineLabels();
    renderSteps(0);
  }

  // A 30-second sprint is a sliver on a 70-minute timeline, and the lowest
  // bars are short stubs, so a label could be clipped to nonsense: show a
  // bar's watts only where it fits both ways.
  function fitTimelineLabels() {
    requestAnimationFrame(() => {
      for (const label of timelineEl.querySelectorAll('.timeline-watts')) {
        label.hidden = false;
        const bar = label.parentElement;
        label.hidden = label.offsetWidth + 8 > bar.clientWidth || label.offsetHeight + 2 > bar.clientHeight;
      }
    });
  }
  window.addEventListener('resize', fitTimelineLabels);

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
      li.title = segmentLabel(segment.label, index);
      stepsListEl.appendChild(li);
    });

    // Say how much is out of view rather than silently truncating.
    const remaining = allSegments.length - (fromIndex + slice.length);
    if (remaining > 0) {
      const more = document.createElement('li');
      more.className = 'steps-more';
      more.textContent = t('live.more', { n: remaining });
      stepsListEl.appendChild(more);
    }
  }

  function updateTimeline(runnerState) {
    timelineSegments.forEach((entry, index) => {
      const done = runnerState.isComplete || index < runnerState.segmentIndex;
      const current = !runnerState.isComplete && index === runnerState.segmentIndex;
      entry.cell.classList.toggle('is-current', current);
      entry.cell.classList.toggle('is-done', done);
      const fraction = done ? 1 : current ? runnerState.progressFraction : 0;
      entry.fill.style.width = `${fraction * 100}%`;
    });

    // The "now" line sits at the exact point reached inside the current bar,
    // measured from the bar itself so the gaps between bars can't skew it.
    const currentEntry = timelineSegments[runnerState.segmentIndex];
    nowLineEl.hidden = runnerState.isComplete || !currentEntry;
    if (!nowLineEl.hidden) {
      const { cell } = currentEntry;
      nowLineEl.style.left = `${cell.offsetLeft + runnerState.progressFraction * cell.offsetWidth}px`;
    }

    // Slide the window forward as segments complete.
    const from = Math.min(runnerState.segmentIndex, Math.max(0, allSegments.length - 1));
    if (allSegments.length && from !== renderedFrom) renderSteps(from);

    stepsProgressEl.textContent = runnerState.isComplete
      ? t('live.done')
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
      segmentLabelEl.textContent = t('summary.title');
      segmentTargetEl.textContent = '--';
      segmentTargetLabelEl.textContent = t('live.targetWatts');
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
    segmentLabelEl.textContent = segmentLabel(segment.label, runnerState.segmentIndex);
    segmentTargetEl.textContent = segment.target_watts;
    segmentTargetLabelEl.textContent = targetLabel(segment.target_watts);
    segmentRemainingEl.textContent = formatTime(runnerState.remainingInSegmentSec);

    const grade = segment.grade_percent ?? 0;
    gradeFigureEl.hidden = grade === 0;
    if (grade !== 0) {
      gradeValueEl.textContent = `${grade > 0 ? '▲' : '▼'}${Math.abs(grade)}%`;
      gradeLabelEl.textContent = t(grade > 0 ? 'live.climbing' : 'live.descending');
    }
  }

  updateWorkoutInfo(null);
  updateZone(null);

  return { updateRawNumbers, updateWorkoutInfo, buildTimeline, setFtp, setElapsed, setTotals, showPauseDialog };
}
