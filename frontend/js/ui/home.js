import { listWorkouts } from '../api/client.js';
import { renderWorkoutRow } from './workouts.js';
import { showView } from './views.js';

export function initHome({ trainerConnection, onStartRide }) {
  const connectBtn = document.getElementById('connect-btn');
  const statusEl = document.getElementById('connection-status');
  const freeRideBtn = document.getElementById('free-ride-btn');
  const workoutListEl = document.getElementById('workout-list');
  const openWorkoutsBtn = document.getElementById('open-workouts-btn');

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

  freeRideBtn.addEventListener('click', () => onStartRide(null));

  openWorkoutsBtn.addEventListener('click', () => showView('workouts'));

  // The home screen is a launchpad: only starred workouts, no management.
  // The full library lives on its own page.
  async function refreshWorkoutList() {
    workoutListEl.innerHTML = '<li>Loading…</li>';
    try {
      const workouts = (await listWorkouts()).filter((w) => w.starred);
      workoutListEl.innerHTML = '';
      if (workouts.length === 0) {
        workoutListEl.innerHTML =
          '<li class="empty">No starred workouts. Star one in Workouts to pin it here.</li>';
        return;
      }
      for (const workout of workouts) {
        workoutListEl.appendChild(renderWorkoutRow(workout, { onStart: onStartRide, compact: true }));
      }
    } catch (err) {
      workoutListEl.innerHTML = `<li class="empty">Could not load workouts: ${err.message}</li>`;
    }
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'home') refreshWorkoutList();
  });

  refreshWorkoutList();

  return { refreshWorkoutList };
}
