// First, so everything after it, including a failed login, is logged.
import { installLogCapture, logEvent } from './log.js';
import { initLanguage, rememberSetting, resolveLanguage, language, t, tp, num } from './i18n.js';
import { applyTheme } from './theme.js';
import { setStravaExport } from './ui/strava-export.js';
import { TrainerConnection } from './ble/connection.js';
import { TrainerControl } from './ble/trainer-control.js';
import { GearModel } from './gears.js';
import { RollingAverage } from './metrics/rolling-average.js';
import { DistanceTracker } from './metrics/distance.js';
import { WorkoutRunner } from './workout/runner.js';
import { SessionRecorder } from './session/recorder.js';
import { stashRide, flushPending, pendingCount } from './session/pending.js';
import { initViews, showView } from './ui/views.js';
import { initHome } from './ui/home.js';
import { initBuilder } from './workout/builder.js';
import { initLiveScreen } from './ui/live-screen.js';
import { createRideHero } from './ui/ride-hero.js';
import { initScenery } from './ui/scenery.js';
import { createSession, getSettings, getProfile, getLevel } from './api/client.js';
import { initProfile, initSettings } from './ui/config-forms.js';
import { initSisyphusLoop } from './ui/sisyphus-loop.js';
import { initChronicle, setChronicleFtp } from './ui/chronicle.js';
import { initWorkouts } from './ui/workouts.js';
import { initFeats } from './ui/feats.js';
import { initBadges, showRideBadges, refreshBadgeCount } from './ui/badges.js';
import { initLeaderboard } from './ui/leaderboard.js';
import { requireLogin, initAccount } from './ui/login.js';
import { initTrainerButton } from './ui/trainer-button.js';
import { initLogPanel } from './ui/log-panel.js';

installLogCapture();
// Before anything renders: the language this browser last used, so even the
// login screen is in it. The account's setting confirms it after login.
initLanguage();
import { resolveTargets } from './workout/targets.js';
import { workoutName } from './workout/names.js';
import { showFtpResult, initFtpHistory, initFtpTestPanel } from './ui/ftp-test.js';

// Nothing below loads data until someone is logged in: requireLogin opens
// the login screen and only resolves once there is a user (or with null
// when the server is unreachable, so the offline shell still starts).
const currentUser = await requireLogin();
if (currentUser) document.getElementById('nav-name').textContent = currentUser.display_name;

const trainerConnection = new TrainerConnection();
const gears = new GearModel();
let trainerControl = null; // created once the trainer's GATT service is up
const rollingAverage = new RollingAverage(10000);
const distanceTracker = new DistanceTracker();
const recorder = new SessionRecorder();
const rideHero = createRideHero(document.getElementById('ride-hero-canvas'));
const scenery = initScenery({
  frameEl: document.getElementById('scenery-frame'),
  pickerEl: document.getElementById('scenery-picker'),
  emptyEl: document.getElementById('scenery-empty'),
});

let runner = null;
// 'gears'  — rider shifts, trainer holds a fixed resistance per gear
// 'erg'    — trainer holds the segment's target watts, gearing is irrelevant
// Both modes drive the same Control Point, so only one may write at a time.
// preferredMode is what the rider chose; rideMode is what the current ride
// actually runs (a free ride forces gears without discarding the choice).
let preferredMode = 'erg';
let rideMode = 'erg';
let activeWorkout = null;
let latestReading = null;
let rideStartedAt = null;
let rideStartedMs = null; // performance clock, for the elapsed readout
let pausedAtMs = null; // set while the ride is paused
let rafId = null;
let recordIntervalId = null;
let sampleIntervalMs = 1000; // overridden by saved settings
let riderFtp = null; // shows targets as %FTP when set
let resistancePerGrade = 0.4; // resistance units added per +1% of grade

initViews();
showView('home');
initTrainerButton(trainerConnection);

const liveScreen = initLiveScreen({
  onPause: (options) => pauseRide(options),
  onResume: () => resumeRide(),
  onEndRide: () => endRide(),
  onDiscardRide: () => discardRide(),
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
initLeaderboard();
initBadges({ onOpenRide: (id) => chronicle.openDetail(id), onOpenBadges: () => showView('badges') });
initProfile();
initSettings({ onSaved: (saved) => applySettings(saved) });
initAccount(currentUser);
// The diagnostic log is for whoever fixes bugs: admins only. Entries are
// still captured for everyone, in case an admin rides on this browser.
document.getElementById('log-panel').hidden = !currentUser?.is_admin;
initLogPanel();
initFtpHistory();
initFtpTestPanel({ onStart: (workout) => startRide(workout) });
updateModeUi();

// Settings are stored server-side, so the objects are built with defaults and
// reconfigured once the saved values arrive.
function applySettings(settings) {
  // The account's language: keep this browser's copy in step, and if it means
  // a different language than the page is in, reload once to redraw in it.
  if (settings.language) {
    rememberSetting(settings.language);
    if (resolveLanguage(settings.language) !== language()) {
      window.location.reload();
      return;
    }
  }
  applyTheme(settings.theme);
  setStravaExport(settings.strava_export);
  scenery.setList(settings.scenery_videos, settings.scenery_mode);
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
refreshBadgeCount();
retryPendingRides();

document.addEventListener('profilechange', (event) => {
  riderFtp = event.detail.ftp > 0 ? event.detail.ftp : null;
  liveScreen.setFtp(riderFtp);
  setChronicleFtp(riderFtp);
  builder.setFtp(riderFtp);
  renderRiderName(event.detail);
});

// The header carries just the rider's name and level; the detailed vitals
// live on the Profile page where they are edited. The account's display
// name wins, since it is how other riders will know you; the profile name
// is the fallback when the server could not be reached to say who you are.
function renderRiderName(profile) {
  document.getElementById('nav-name').textContent =
    currentUser?.display_name || profile.name?.trim() || t('app.anonymous');
}

// Level is derived from the ride log, so it is refreshed after every Push
// as well as at startup.
async function refreshLevel() {
  try {
    const data = await getLevel();
    document.getElementById('nav-level').textContent = t('app.level', { n: data.level });
    document.getElementById('profile-level').textContent = t('app.level', { n: data.level });
    document.getElementById('level-fill').style.width = `${Math.round(data.progress * 100)}%`;
    document.getElementById('level-detail').textContent =
      `${t('profile.xpToLevel', { into: num(data.into_level), needed: num(data.needed_for_next), next: data.level + 1 })} · ` +
      `${tp('unit.pushes', data.totals.pushes)} · ${num(data.totals.minutes)} min · ${num(data.totals.distance_km, 1)} km`;
  } catch (err) {
    console.warn('[app] level unavailable:', err.message);
  }
}

document.getElementById('summary-home-btn').addEventListener('click', () => {
  rideMode = preferredMode; // the ride is over; show what's chosen for next time
  updateModeUi();
  showView('home');
});

// A dropped or deliberately ended connection takes the control point with
// it; the next connection must set a fresh one up rather than reuse this.
trainerConnection.addEventListener('disconnected', () => {
  trainerControl = null;
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
    flashRideNote(t('note.controlFailed', { error: err.message }));
    trainerControl = null;
    return false;
  }
}

// Applies a shift and confirms it on screen — even at an end stop, where
// the gear number can't change — so a press is always visibly acknowledged.
function handleShift(direction) {
  if (rideMode === 'erg') {
    // Writing resistance now would fight the trainer's ERG target.
    flashRideNote(t('note.ergNoGears'), 1500);
    return;
  }
  const up = direction === 'up';
  const moved = up ? gears.shiftUp() : gears.shiftDown();
  updateGearDisplay(gears.gearNumber);
  const arrow = up ? '▲' : '▼';
  if (moved) flashRideNote(`${arrow} ${t('note.gear', { n: gears.gearNumber })}`, 1500);
  else flashRideNote(`${arrow} ${t(up ? 'note.topGear' : 'note.lowestGear')}`, 1500);
}

// Keyboard shifting. Any Bluetooth/USB keyboard mounted on the bars works:
// + (or =, so no Shift needed on the main row) shifts up, - shifts down.
const liveViewEl = document.querySelector('[data-view="live"]');
document.addEventListener('keydown', (event) => {
  if (event.repeat) return; // one shift per physical press
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (liveViewEl.hidden) return; // only shift during a ride
  if (pausedAtMs != null) return; // the pause pop-up owns the keys

  if (event.key === ' ') {
    event.preventDefault();
    pauseRide();
    return;
  }

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
    } catch {
      // Trainer may have dropped control (e.g. during a long pause);
      // re-acquire once and retry, as applyResistance does.
      try {
        await trainerControl.requestControl();
        await trainerControl.setPower(target);
      } catch (err) {
        flashRideNote(t('note.ergFailed', { error: err.message }));
        return;
      }
    }
    flashRideNote(t('note.ergHolding', { watts: target }), 2000);
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
  document.getElementById('mode-description').textContent = t(erg ? 'mode.ergDescription' : 'mode.gearsDescription');
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
      flashRideNote(t('note.resistanceFailed', { error: err2.message }));
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
  if (pausedAtMs != null) return; // nothing counts while paused

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

  const zone = liveScreen.updateRawNumbers({
    powerSmoothed: rollingAverage.average(),
    cadence: reading.instantaneousCadenceRpm,
    speed: reading.instantaneousSpeedKmh,
  });
  // Only fires when the zone actually changes: Sisyphus leans in harder and
  // works faster the deeper the rider is into their zones.
  if (zone) rideHero.setZone(zone.id, zone.color);
});

function startRide(workout) {
  // Library targets are % of FTP; from here on everything is in watts,
  // fixed at the FTP the rider has as the ride starts.
  if (workout) workout = { ...workout, structure: resolveTargets(workout.structure, riderFtp) };
  activeWorkout = workout;
  rollingAverage.reset();
  distanceTracker.reset();
  recorder.reset();
  recorder.start(performance.now());
  latestReading = null;
  rideStartedAt = new Date().toISOString();
  rideStartedMs = performance.now();
  pausedAtMs = null;

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
  // that must not discard an ERG choice made for the next workout. FTP tests
  // run in gears too: ERG would hold the test block at your CURRENT FTP, so
  // it could only ever measure what you already have.
  const isTest = Boolean(workout?.test);
  rideMode = workout && !isTest ? preferredMode : 'gears';
  updateModeUi();

  liveScreen.buildTimeline(workout ? workout.structure : null, workout ? workoutName(workout) : null);
  liveScreen.updateWorkoutInfo(runner ? runner.state : null);
  liveScreen.setElapsed(0);
  updateTotals();
  updateGearDisplay(gears.gearNumber);

  showView('live');
  if (isTest) {
    flashRideNote(t('note.ftpTest'), 12000);
  }
  scenery.start();
  startLoop();
  applyRideMode();
}

function startLoop() {
  // Commit the mean of every reading received since the last tick. Raw
  // values only — smoothing is a display concern, never stored.
  // The ride-so-far figures refresh with each committed sample.
  recordIntervalId = setInterval(() => {
    recorder.commitSample(performance.now());
    updateTotals();
  }, sampleIntervalMs);

  function frame(now) {
    if (runner) {
      const state = runner.tick(now);
      liveScreen.updateWorkoutInfo(state);
    }
    if (rideStartedMs != null) liveScreen.setElapsed((now - rideStartedMs) / 1000);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

function updateTotals() {
  liveScreen.setTotals({
    avgPowerW: recorder.averagePower(),
    avgSpeedKmh: recorder.averageSpeed(),
    distanceM: distanceTracker.currentTotalM,
  });
}

function stopLoop() {
  if (rafId != null) cancelAnimationFrame(rafId);
  if (recordIntervalId != null) clearInterval(recordIntervalId);
  rafId = null;
  recordIntervalId = null;
}

// Pausing freezes everything that measures the ride (workout clock,
// elapsed time, recording, distance) and drops the trainer to no load, so
// the rider can stop and later restart the pedals without fighting an ERG
// target. Paused time is never counted as riding.
// confirmEnd opens the pop-up on the End Ride confirmation; the ride is
// paused while the rider decides either way.
function pauseRide({ confirmEnd = false } = {}) {
  if (pausedAtMs != null || liveViewEl.hidden) return;
  const now = performance.now();
  pausedAtMs = now;
  stopLoop();
  runner?.stop();
  recorder.pause(now);
  scenery.pause();
  const workout = runner?.state;
  liveScreen.showPauseDialog({
    distanceM: distanceTracker.currentTotalM,
    avgPowerW: recorder.averagePower(),
    timeLeftSec: workout ? workout.totalDurationSec - workout.totalElapsedSec : null,
    elapsedSec: (now - rideStartedMs) / 1000,
  }, { confirmEnd });
  if (trainerControl) applyResistance(0);
}

function resumeRide() {
  if (pausedAtMs == null) return;
  const now = performance.now();
  // Shifting the start forward by the pause keeps the elapsed clock and
  // the ride's duration to riding time only.
  rideStartedMs += now - pausedAtMs;
  pausedAtMs = null;
  recorder.resume(now);
  distanceTracker.resume();
  rollingAverage.reset(); // pre-pause watts would drag the 10s average
  runner?.resume(now);
  scenery.play();
  startLoop();
  applyRideMode(); // put back the ERG target or the gear's resistance
}

// Release the trainer: in ERG it would otherwise keep forcing the last
// target on the rider after the ride has ended.
async function releaseTrainer() {
  if (!trainerControl) return;
  try {
    await trainerControl.reset();
  } catch (err) {
    console.warn('[app] trainer reset failed:', err.message);
  }
}

// Ends the ride without saving anything: the rider chose to throw it away
// (Cancel Ride, or Don't Save), so nothing is sent and nothing is parked.
async function discardRide() {
  stopLoop();
  scenery.stop();
  pausedAtMs = null;
  recorder.reset();
  await releaseTrainer();
  rideMode = preferredMode; // show what's chosen for next time
  updateModeUi();
  showView('home');
}

async function endRide() {
  stopLoop();
  scenery.stop();
  // A ride ended from the pause pop-up ends where the riding stopped.
  const endMs = pausedAtMs ?? performance.now();
  pausedAtMs = null;

  await releaseTrainer();

  // A ride ended before the first tick still needs one row to be saveable.
  if (recorder.getSamples().length === 0) {
    recorder.commitSample(endMs);
  }

  const payload = {
    workout_id: activeWorkout?.id ?? null,
    started_at: rideStartedAt,
    // Start plus riding time, not the wall clock: duration, XP and the
    // longest-ride record all read ended_at - started_at, so a pause must
    // not count. Without a pause the two are the same.
    ended_at: new Date(Date.parse(rideStartedAt) + (endMs - rideStartedMs)).toISOString(),
    distance_m: distanceTracker.currentTotalM,
    // The true peak across every raw reading, not the peak of the committed
    // means — a 30s sprint would otherwise be flattened by windowing.
    max_power: recorder.getMaxPower(),
    // Kept with the ride so a % FTP workout's targets can be redrawn as the
    // watts that were actually chased, even after the FTP changes.
    ftp: riderFtp,
    // Minutes east of UTC, so date and time badges use the rider's local time.
    tz_offset_min: -new Date(rideStartedAt).getTimezoneOffset(),
    samples: recorder.getSamples(),
  };

  try {
    const session = await createSession(payload);
    refreshLevel();
    refreshBadgeCount();
    showSummary(session);
    if (activeWorkout?.test) showFtpResult(document.getElementById('summary-ftp-result'), session.id);
    showRideBadges(document.getElementById('summary-badges'), session.id, { onOpenRide: (id) => chronicle.openDetail(id) });
  } catch (err) {
    // Never drop the ride. Park it and retry on the next load — the rider
    // cannot pedal the hour again.
    logEvent('error', `Could not save the ride: ${err.message}`);
    const kept = stashRide(payload, currentUser?.id);
    if (kept) {
      alert(`${t('save.failed', { error: err.message })}\n\n${t('save.kept')}`);
    } else {
      alert(`${t('save.failed', { error: err.message })}\n\n${t('save.notKept')}`);
    }
    showView('home');
  }
}

// Any ride parked by a failed save is retried as soon as the app loads.
async function retryPendingRides() {
  if (pendingCount(currentUser?.id) === 0) return;
  const { saved, remaining } = await flushPending(createSession, currentUser?.id);
  if (saved > 0) {
    refreshLevel();
    refreshBadgeCount();
    home.refreshWorkoutList();
    flashRideNote(tp('save.recovered', saved), 8000);
    console.info(`[app] recovered ${saved} pending ride(s)`);
  }
  if (remaining > 0) {
    console.warn(`[app] ${remaining} ride(s) still waiting for the server`);
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
    label.textContent = t('live.mode');
  } else {
    value.textContent = gear;
    label.textContent = t('live.gear');
  }
}

function showSummary(session) {
  document.getElementById('summary-ftp-result').hidden = true;
  document.getElementById('summary-badges').hidden = true;
  const statsEl = document.getElementById('summary-stats');
  statsEl.innerHTML = '';
  const entries = [
    [t('stat.distance'), session.distance_m != null ? `${num(session.distance_m / 1000, 2)} km` : '--'],
    [t('stat.avgPower'), session.avg_power != null ? `${Math.round(session.avg_power)} W` : '--'],
    [t('stat.maxPower'), session.max_power != null ? `${Math.round(session.max_power)} W` : '--'],
    [t('stat.avgCadence'), session.avg_cadence != null ? `${Math.round(session.avg_cadence)} ${t('unit.rpm')}` : '--'],
    [t('stat.avgSpeed'), session.avg_speed != null ? `${num(session.avg_speed, 1)} km/h` : '--'],
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

// Register the offline shell. Failure is non-fatal: the app works fine
// without a service worker, it simply won't run offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[app] service worker not registered:', err.message);
    });
  });
}
