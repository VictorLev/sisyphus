import { TrainerConnection } from './ble/connection.js';
import { TrainerControl } from './ble/trainer-control.js';
import { ZwiftClickConnection } from './ble/zwift-click.js';
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
import { createSession } from './api/client.js';

const trainerConnection = new TrainerConnection();
const clickConnection = new ZwiftClickConnection();
const gears = new GearModel();
let trainerControl = null; // created once the trainer's GATT service is up
const rollingAverage = new RollingAverage(10000);
const distanceTracker = new DistanceTracker();
const recorder = new SessionRecorder();
const boulder = createBoulder(document.getElementById('boulder-canvas'));

let runner = null;
let activeWorkout = null;
let latestReading = null;
let rideStartedAt = null;
let rafId = null;
let recordIntervalId = null;

initViews();
showView('home');

const liveScreen = initLiveScreen({
  onEndRide: () => endRide(),
});

initHome({
  trainerConnection,
  clickConnection,
  onStartRide: (workout) => startRide(workout),
});

initBuilder({});

document.getElementById('summary-home-btn').addEventListener('click', () => showView('home'));

// Once the trainer is connected, attach the control point (same GATT
// connection) and take control so shifting can write resistance.
trainerConnection.addEventListener('connected', async () => {
  try {
    trainerControl = new TrainerControl(trainerConnection.service);
    await trainerControl.init();
    await trainerControl.requestControl();
    await trainerControl.setResistance(gears.resistance); // apply the starting gear
  } catch (err) {
    console.warn('[app] trainer control unavailable:', err.message);
    trainerControl = null;
  }
});

// Wire the Click's shift events into the gear model.
clickConnection.addEventListener('shift', (event) => {
  const moved = event.detail.direction === 'up' ? gears.shiftUp() : gears.shiftDown();
  if (!moved) return; // at an end stop
});

// A gear change updates the display and writes the new resistance.
gears.addEventListener('change', (event) => {
  updateGearDisplay(event.detail.gear);
  if (trainerControl) {
    trainerControl.setResistance(event.detail.resistance).catch((err) => {
      console.warn('[app] resistance write failed:', err.message);
    });
  }
});

trainerConnection.addEventListener('reading', (event) => {
  const { reading, receivedAt } = event.detail;
  latestReading = reading;

  if (reading.instantaneousPowerW != null) {
    rollingAverage.push(reading.instantaneousPowerW, receivedAt);
  }
  distanceTracker.update(reading, receivedAt);

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
  if (runner) runner.start(performance.now());

  liveScreen.updateWorkoutInfo(runner ? runner.state : null);
  boulder.setProgress(0);
  updateGearDisplay(gears.gearNumber);

  showView('live');
  startLoop();
}

function startLoop() {
  recordIntervalId = setInterval(() => {
    // Record raw instantaneous power, not the smoothed value — smoothing is
    // a display concern. Storing the 10s average here would make max_power
    // the peak of an average (badly under-reporting sprints) and would throw
    // away the raw series that best-effort records are computed from.
    recorder.addSample(
      {
        power: latestReading?.instantaneousPowerW ?? null,
        cadence: latestReading?.instantaneousCadenceRpm ?? null,
        speed: latestReading?.instantaneousSpeedKmh ?? null,
        heartRate: latestReading?.heartRateBpm ?? null,
      },
      performance.now()
    );
  }, 1000);

  function frame(now) {
    if (runner) {
      const state = runner.tick(now);
      liveScreen.updateWorkoutInfo(state);
      // On completion currentSegment is null and progressFraction resets to
      // 0; keep the boulder at the summit instead of letting it drop.
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

  if (recorder.getSamples().length === 0) {
    recorder.addSample(
      {
        power: latestReading?.instantaneousPowerW ?? null,
        cadence: latestReading?.instantaneousCadenceRpm ?? null,
        speed: latestReading?.instantaneousSpeedKmh ?? null,
        heartRate: latestReading?.heartRateBpm ?? null,
      },
      performance.now()
    );
  }

  const payload = {
    workout_id: activeWorkout?.id ?? null,
    started_at: rideStartedAt,
    ended_at: new Date().toISOString(),
    distance_m: distanceTracker.currentTotalM,
    samples: recorder.getSamples(),
  };

  try {
    const session = await createSession(payload);
    showSummary(session);
  } catch (err) {
    alert(`Could not save the Push: ${err.message}`);
    showView('home');
  }
}

function updateGearDisplay(gear) {
  const metric = document.getElementById('gear-metric');
  const value = document.getElementById('gear-value');
  // Only show the gear tile when the Click is actually connected.
  metric.hidden = !clickConnection.device;
  value.textContent = gear;
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
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    statsEl.appendChild(dt);
    statsEl.appendChild(dd);
  }
  showView('summary');
}
