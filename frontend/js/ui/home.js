import { listWorkouts } from '../api/client.js';
import { showView } from './views.js';

export function initHome({ trainerConnection, createClickConnection, anyClickConnected, onStartRide }) {
  const connectBtn = document.getElementById('connect-btn');
  const statusEl = document.getElementById('connection-status');
  const clickBtn = document.getElementById('connect-click-btn');
  const clickStatusEl = document.getElementById('click-status');
  const freeRideBtn = document.getElementById('free-ride-btn');
  const workoutListEl = document.getElementById('workout-list');
  const newWorkoutBtn = document.getElementById('new-workout-btn');

  let connectedClicks = 0;
  function renderClickStatus(extra) {
    const base = connectedClicks === 0
      ? 'No units connected'
      : `${connectedClicks} unit${connectedClicks > 1 ? 's' : ''} connected`;
    clickStatusEl.textContent = extra ? `${base} — ${extra}` : base;
  }

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    statusEl.textContent = 'Connecting…';
    try {
      await trainerConnection.connect();
    } catch (err) {
      statusEl.textContent = `Connection failed: ${err.message}`;
    } finally {
      connectBtn.disabled = false;
    }
  });

  trainerConnection.addEventListener('connected', (event) => {
    statusEl.textContent = `Connected: ${event.detail.deviceName || 'trainer'}`;
    freeRideBtn.disabled = false;
  });

  trainerConnection.addEventListener('disconnected', () => {
    statusEl.textContent = 'Not connected';
    freeRideBtn.disabled = true;
  });

  // Each press connects one more unit. Two-piece controllers pair as two
  // separate devices (left '-' and right '+'), so press this once per unit.
  clickBtn.addEventListener('click', async () => {
    clickBtn.disabled = true;
    clickStatusEl.textContent = 'Select a unit in the chooser…';

    const click = createClickConnection();
    click.addEventListener('connected', () => {
      connectedClicks += 1;
      renderClickStatus('press + / − to shift');
    });
    click.addEventListener('reconnecting', (event) => {
      renderClickStatus(`reconnecting (try ${event.detail.attempt})…`);
    });
    click.addEventListener('reconnect-failed', () => {
      connectedClicks = Math.max(0, connectedClicks - 1);
      renderClickStatus('a unit dropped — reconnect it');
    });
    click.addEventListener('disconnected', (event) => {
      if (event.detail?.intentional) {
        connectedClicks = Math.max(0, connectedClicks - 1);
        renderClickStatus();
      }
      // unintentional drops are handled by auto-reconnect above
    });

    try {
      await click.connect();
      clickBtn.textContent = 'Connect Another Unit';
    } catch (err) {
      renderClickStatus(`connect failed: ${err.message}`);
    } finally {
      clickBtn.disabled = false;
    }
  });

  renderClickStatus();

  freeRideBtn.addEventListener('click', () => onStartRide(null));

  newWorkoutBtn.addEventListener('click', () => showView('builder'));

  async function refreshWorkoutList() {
    workoutListEl.innerHTML = '<li>Loading…</li>';
    try {
      const workouts = await listWorkouts();
      workoutListEl.innerHTML = '';
      if (workouts.length === 0) {
        workoutListEl.innerHTML = '<li class="empty">No workouts yet.</li>';
        return;
      }
      for (const workout of workouts) {
        const li = document.createElement('li');
        const totalSec = workout.structure.reduce((sum, s) => sum + s.duration_sec, 0);
        li.innerHTML = `<span>${workout.name} (${workout.structure.length} segments, ${Math.round(totalSec / 60)} min)</span>`;
        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.textContent = 'Start';
        startBtn.addEventListener('click', () => onStartRide(workout));
        li.appendChild(startBtn);
        workoutListEl.appendChild(li);
      }
    } catch (err) {
      workoutListEl.innerHTML = `<li class="empty">Could not load workouts: ${err.message}</li>`;
    }
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'home') refreshWorkoutList();
  });

  refreshWorkoutList();
}
