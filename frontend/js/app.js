import { TrainerConnection } from './ble/connection.js';
import { TrainerControl } from './ble/trainer-control.js';
import { GearModel } from './gears.js';
import { RollingAverage } from './metrics/rolling-average.js';
import { DistanceTracker } from './metrics/distance.js';
import { WorkoutRunner } from './workout/runner.js';
import { SessionRecorder } from './session/recorder.js';
import { initViews, showView } from './ui/views.js';
import { initHome } from './ui/home.js';
import { initBuilder } from './workout/builder.js';
import { initLiveScreen } from './ui/live-screen.js';
import { createBoulder } from './ui/boulder.js';
import { createSession, getSettings, getProfile, getLevel } from './api/client.js';
import { initProfile, initSettings } from './ui/config-forms.js';
import { initSisyphusLoop } from './ui/sisyphus-loop.js';
import { initChronicle, setChronicleFtp } from './ui/chronicle.js';
import { initWorkouts } from './ui/workouts.js';
import { initFeats } from './ui/feats.js';

const trainerConnection = new TrainerConnection();
const gears = new GearModel();
let trainerControl = null; // created once the trainer's GATT service is up
const rollingAverage = new RollingAverage(10000);
const distanceTracker = new DistanceTracker();
const recorder = new SessionRecorder();
const boulder = createBoulder(document.getElementById('boulder-canvas'));

let runner = null;
// 'gears'  — rider shifts, trainer holds a fixed resistance per gear
// 'erg'    — trainer holds the segment's target watts, gearing is irrelevant
// Both modes drive the same Control Point, so only one may write at a time.
// preferredMode is what the rider chose; rideMode is what the current ride
// actually runs (a free ride forces gears without discarding the choice).
let preferredMode = 'gears';
let rideMode = 'gears';
let activeWorkout = null;
let latestReading = null;
let rideStartedAt = null;
let rafId = null;
let recordIntervalId = null;
let sampleIntervalMs = 1000; // overridden by saved settings
let riderFtp = null; // shows targets as %FTP when set
let resistancePerGrade = 0.4; // resistance units added per +1% of grade

initViews();
showView('home');

const liveScreen = initLiveScreen({
  onEndRide: () => endRide(),
});

const home = initHome({
  trainerConnection,
  onStartRide: (workout) => startRide(workout),
});

initWorkouts({
  onStartRide: (workout) => startRide(workout),
  onEditWorkout: (workout) => editWorkout(workout),
  // Starring or deleting changes what the home launchpad should show.
  onLibraryChanged: () => home.refreshWorkoutList(),
});

const builder = initBuilder({});

// Arriving at Build from the nav should start blank; arriving via a
// workout's Edit button should keep the loaded workout. The Edit path sets
// this flag immediately before switching views.
let enteringBuilderForEdit = false;
document.addEventListener('viewchange', (event) => {
  if (event.detail.view !== 'builder') return;
  if (enteringBuilderForEdit) enteringBuilderForEdit = false;
  else builder.reset();
});

function editWorkout(workout) {
  enteringBuilderForEdit = true;
  builder.loadWorkout(workout);
  showView('builder');
}
initSisyphusLoop();
const chronicle = initChronicle();
initFeats({ onOpenRide: (id) => chronicle.openDetail(id) });
initProfile();
initSettings({ onSaved: (saved) => applySettings(saved) });
updateModeUi();

// Settings are stored server-side, so the objects are built with defaults and
// reconfigured once the saved values arrive.
function applySettings(settings) {
  gears.configure({
    gearCount: settings.gear_count,
    minResistance: settings.min_resistance,
    maxResistance: settings.max_resistance,
    startGear: settings.start_gear,
  });
  rollingAverage.windowMs = Math.max(1, settings.power_smoothing_sec) * 1000;
  if (Number.isFinite(settings.resistance_per_grade)) {
    resistancePerGrade = settings.resistance_per_grade;
  }
  sampleIntervalMs = Math.max(1, settings.sample_interval_sec) * 1000;
  if (settings.default_mode === 'gears' || settings.default_mode === 'erg') {
    preferredMode = settings.default_mode;
    rideMode = preferredMode;
  }
  updateModeUi();
}

async function loadConfig() {
  try {
    applySettings(await getSettings());
  } catch (err) {
    console.warn('[app] using default settings:', err.message);
  }
  try {
    const profile = await getProfile();
    riderFtp = profile.ftp > 0 ? profile.ftp : null;
    liveScreen.setFtp(riderFtp);
    setChronicleFtp(riderFtp);
    builder.setFtp(riderFtp);
    renderRiderName(profile);
  } catch { /* %FTP display is optional */ }
}
loadConfig();
refreshLevel();

document.addEventListener('profilechange', (event) => {
  riderFtp = event.detail.ftp > 0 ? event.detail.ftp : null;
  liveScreen.setFtp(riderFtp);
  setChronicleFtp(riderFtp);
  builder.setFtp(riderFtp);
  renderRiderName(event.detail);
});

// The header carries just the rider's name and level; the detailed vitals
// live on the Profile page where they are edited.
function renderRiderName(profile) {
  document.getElementById('nav-name').textContent = profile.name?.trim() || 'Anonymous';
}

// Level is derived from the ride log, so it is refreshed after every Push
// as well as at startup.
async function refreshLevel() {
  try {
    const data = await getLevel();
    document.getElementById('nav-level').textContent = `Lv ${data.level}`;
    document.getElementById('profile-level').textContent = `Lv ${data.level}`;
    document.getElementById('level-fill').style.width = `${Math.round(data.progress * 100)}%`;
    document.getElementById('level-detail').textContent =
      `${data.into_level} / ${data.needed_for_next} XP to level ${data.level + 1} · ` +
      `${data.totals.pushes} Pushes · ${data.totals.minutes} min · ${data.totals.distance_km} km`;
  } catch (err) {
    console.warn('[app] level unavailable:', err.message);
  }
}

document.getElementById('summary-home-btn').addEventListener('click', () => {
  rideMode = preferredMode; // the ride is over; show what's chosen for next time
  updateModeUi();
  showView('home');
});

// Once the trainer is connected, attach the control point (same GATT
// connection) and take control so shifting can write resistance.
trainerConnection.addEventListener('connected', () => {
  // Best-effort at connect time; the real setup is lazy (see
  // ensureTrainerControl) so a failure surfaces on the visible live screen
  // rather than into the hidden home view.
  ensureTrainerControl().then((ok) => {
    if (ok) trainerControl.setResistance(terrainResistance()).catch(() => {});
  });
});

// Creates and initialises the control point + takes control, once. Returns
// true if control is ready. Any failure is surfaced via the ride note.
async function ensureTrainerControl() {
  if (trainerControl) return true;
  if (!trainerConnection.service) return false; // trainer not connected
  try {
    const control = new TrainerControl(trainerConnection.service);
    await control.init();
    await control.requestControl();
    trainerControl = control;
    console.info('[app] trainer control ready');
    return true;
  } catch (err) {
    console.warn('[app] trainer control setup failed:', err.message);
    flashRideNote(`Trainer control failed: ${err.message}`);
    trainerControl = null;
    return false;
  }
}

// Applies a shift and confirms it on screen — even at an end stop, where
// the gear number can't change — so a press is always visibly acknowledged.
function handleShift(direction) {
  if (rideMode === 'erg') {
    // Writing resistance now would fight the trainer's ERG target.
    flashRideNote('ERG holds the target — gears do nothing', 1500);
    return;
  }
  const up = direction === 'up';
  const moved = up ? gears.shiftUp() : gears.shiftDown();
  updateGearDisplay(gears.gearNumber);
  const arrow = up ? '▲' : '▼';
  if (moved) flashRideNote(`${arrow} Gear ${gears.gearNumber}`, 1500);
  else flashRideNote(`${arrow} ${up ? 'top' : 'lowest'} gear`, 1500);
}

// Keyboard shifting. Any Bluetooth/USB keyboard mounted on the bars works:
// + (or =, so no Shift needed on the main row) shifts up, - shifts down.
const liveViewEl = document.querySelector('[data-view="live"]');
document.addEventListener('keydown', (event) => {
  if (event.repeat) return; // one shift per physical press
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (liveViewEl.hidden) return; // only shift during a ride

  let direction = null;
  if (event.key === '+' || event.key === '=') direction = 'up';
  else if (event.key === '-') direction = 'down';
  if (!direction) return;

  event.preventDefault();
  handleShift(direction);
});

// Applies whichever control the current mode owns. In ERG that's the active
// segment's target watts; in gears it's the current gear's resistance.
async function applyRideMode() {
  if (!(await ensureTrainerControl())) return;
  if (rideMode === 'erg') {
    const target = runner?.state.currentSegment?.target_watts;
    if (target == null) return; // nothing to hold (free ride or finished)
    try {
      await trainerControl.setPower(target);
      flashRideNote(`ERG holding ${target} W`, 2000);
    } catch (err) {
      flashRideNote(`ERG failed: ${err.message}`);
    }
  } else {
    applyResistance(terrainResistance());
  }
}

// Mode is chosen before a ride starts, never during one — so this only
// records the choice. The trainer is written to in startRide.
function setRideMode(mode) {
  preferredMode = mode;
  rideMode = mode;
  updateModeUi();
}

function updateModeUi() {
  const erg = rideMode === 'erg';
  document.getElementById('mode-gears-btn').classList.toggle('is-active', !erg);
  document.getElementById('mode-erg-btn').classList.toggle('is-active', erg);
  document.getElementById('mode-description').textContent = erg
    ? 'ERG: the trainer forces each segment\'s target watts on you. Gearing does nothing — just pedal. Workouts only; free rides use gears.'
    : 'Virtual gears: resistance is fixed per gear and you chase the target yourself. + / − to shift during a ride.';
  updateGearDisplay(gears.gearNumber);
}

document.getElementById('mode-gears-btn').addEventListener('click', () => setRideMode('gears'));
document.getElementById('mode-erg-btn').addEventListener('click', () => setRideMode('erg'));

// The trainer only has one resistance dial, so terrain and gearing are
// composed into it: the segment's grade sets the load, the gear is the
// rider's lever against it. Clamped to the device's 0..20 domain, so a
// descent bottoms out at freewheel rather than going negative.
function currentGrade() {
  if (rideMode !== 'gears') return 0; // ERG holds watts; terrain is irrelevant
  return runner?.state.currentSegment?.grade_percent ?? 0;
}

function terrainResistance() {
  const withGrade = gears.resistance + currentGrade() * resistancePerGrade;
  return Math.max(0, Math.min(20, withGrade));
}

// A gear change updates the display and writes the new resistance.
gears.addEventListener('change', (event) => {
  updateGearDisplay(event.detail.gear);
  applyResistance(terrainResistance());
});

// Writes resistance, re-acquiring control if the trainer dropped it (FTMS
// trainers commonly release control after a period with no commands, so a
// shift minutes after connect would otherwise fail silently).
async function applyResistance(resistance) {
  // Lazily set up control on the first shift if connect-time setup didn't
  // take — this runs on the visible live screen, so errors are seen.
  if (!(await ensureTrainerControl())) return;
  try {
    await trainerControl.setResistance(resistance);
  } catch (err) {
    // Trainer may have dropped control; re-acquire once and retry.
    try {
      await trainerControl.requestControl();
      await trainerControl.setResistance(resistance);
    } catch (err2) {
      console.warn('[app] resistance write failed:', err2.message);
      flashRideNote(`Resistance write failed: ${err2.message}`);
    }
  }
}

let rideNoteTimer = null;
function flashRideNote(message, durationMs = 6000) {
  const el = document.getElementById('ride-note');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(rideNoteTimer);
  rideNoteTimer = setTimeout(() => { el.hidden = true; }, durationMs);
}

trainerConnection.addEventListener('reading', (event) => {
  const { reading, receivedAt } = event.detail;
  latestReading = reading;

  if (reading.instantaneousPowerW != null) {
    rollingAverage.push(reading.instantaneousPowerW, receivedAt);
  }
  distanceTracker.update(reading, receivedAt);
  // Accumulate every notification; the recording tick commits their mean.
  recorder.addReading({
    power: reading.instantaneousPowerW,
    cadence: reading.instantaneousCadenceRpm,
    speed: reading.instantaneousSpeedKmh,
    heartRate: reading.heartRateBpm,
  });

  liveScreen.updateRawNumbers({
    powerSmoothed: rollingAverage.average(),
    cadence: reading.instantaneousCadenceRpm,
    speed: reading.instantaneousSpeedKmh,
  });
});

function startRide(workout) {
  activeWorkout = workout;
  rollingAverage.reset();
  distanceTracker.reset();
  recorder.reset();
  recorder.start(performance.now());
  latestReading = null;
  rideStartedAt = new Date().toISOString();

  runner = workout ? new WorkoutRunner(workout.structure) : null;
  if (runner) {
    runner.start(performance.now());
    // In ERG each segment's target has to be pushed to the trainer as it
    // begins; in gears mode this is a no-op.
    // Every segment boundary changes the load: a new ERG target, or new
    // terrain to push the gears against.
    runner.addEventListener('segment-change', () => applyRideMode());
  }

  // ERG needs a workout's targets, so free rides always run in gears — but
  // that must not discard an ERG choice made for the next workout.
  rideMode = workout ? preferredMode : 'gears';
  updateModeUi();

  liveScreen.buildTimeline(workout ? workout.structure : null);
  liveScreen.updateWorkoutInfo(runner ? runner.state : null);
  boulder.setProgress(0);
  updateGearDisplay(gears.gearNumber);

  showView('live');
  startLoop();
  applyRideMode();
}

function startLoop() {
  // Commit the mean of every reading received since the last tick. Raw
  // values only — smoothing is a display concern, never stored.
  recordIntervalId = setInterval(() => recorder.commitSample(performance.now()), sampleIntervalMs);

  function frame(now) {
    if (runner) {
      const state = runner.tick(now);
      liveScreen.updateWorkoutInfo(state);
      // On completion currentSegment is null and progressFraction resets to
      // 0; keep the boulder at the summit instead of letting it drop.
      boulder.setGrade(state.currentSegment?.grade_percent ?? 0);
      boulder.setProgress(state.isComplete ? 1 : state.progressFraction);
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId != null) cancelAnimationFrame(rafId);
  if (recordIntervalId != null) clearInterval(recordIntervalId);
  rafId = null;
  recordIntervalId = null;
}

async function endRide() {
  stopLoop();

  // Release the trainer: in ERG it would otherwise keep forcing the last
  // target on the rider after the ride has ended.
  if (trainerControl) {
    try {
      await trainerControl.reset();
    } catch (err) {
      console.warn('[app] trainer reset failed:', err.message);
    }
  }

  // A ride ended before the first tick still needs one row to be saveable.
  if (recorder.getSamples().length === 0) {
    recorder.commitSample(performance.now());
  }

  const payload = {
    workout_id: activeWorkout?.id ?? null,
    started_at: rideStartedAt,
    ended_at: new Date().toISOString(),
    distance_m: distanceTracker.currentTotalM,
    // The true peak across every raw reading, not the peak of the committed
    // means — a 30s sprint would otherwise be flattened by windowing.
    max_power: recorder.getMaxPower(),
    samples: recorder.getSamples(),
  };

  try {
    const session = await createSession(payload);
    refreshLevel();
    showSummary(session);
  } catch (err) {
    alert(`Could not save the Push: ${err.message}`);
    showView('home');
  }
}

function updateGearDisplay(gear) {
  const metric = document.getElementById('gear-metric');
  const value = document.getElementById('gear-value');
  const label = metric.querySelector('.metric-label');
  metric.hidden = false;
  if (rideMode === 'erg') {
    // The gear number is meaningless while the trainer holds a wattage.
    value.textContent = 'ERG';
    label.textContent = 'mode';
  } else {
    value.textContent = gear;
    label.textContent = 'gear';
  }
}

function showSummary(session) {
  const statsEl = document.getElementById('summary-stats');
  statsEl.innerHTML = '';
  const entries = [
    ['Distance', session.distance_m != null ? `${(session.distance_m / 1000).toFixed(2)} km` : '--'],
    ['Avg Power', session.avg_power != null ? `${Math.round(session.avg_power)} W` : '--'],
    ['Max Power', session.max_power != null ? `${Math.round(session.max_power)} W` : '--'],
    ['Avg Cadence', session.avg_cadence != null ? `${Math.round(session.avg_cadence)} rpm` : '--'],
    ['Avg Speed', session.avg_speed != null ? `${session.avg_speed.toFixed(1)} km/h` : '--'],
  ];
  for (const [label, value] of entries) {
    const card = document.createElement('div');
    card.className = 'summary-stat';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    card.appendChild(dt);
    card.appendChild(dd);
    statsEl.appendChild(card);
  }
  showView('summary');
}
