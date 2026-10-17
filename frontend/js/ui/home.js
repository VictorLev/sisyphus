import { listWorkouts } from '../api/client.js';
import { renderWorkoutRow } from './workouts.js';
import { showView } from './views.js';

// Connecting the trainer lives in the header (ui/trainer-button.js); the
// home screen only reacts to it, enabling Free Ride once connected.
export function initHome({ trainerConnection, onStartRide }) {
  const freeRideBtn = document.getElementById('free-ride-btn');
  const workoutListEl = document.getElementById('workout-list');
  const openWorkoutsBtn = document.getElementById('open-workouts-btn');

  trainerConnection.addEventListener('connected', () => {
    freeRideBtn.disabled = false;
  });

  trainerConnection.addEventListener('disconnected', () => {
    freeRideBtn.disabled = true;
  });

  freeRideBtn.addEventListener('click', () => onStartRide(null));

  openWorkoutsBtn.addEventListener('click', () => showView('workouts'));

  // The home screen is a launchpad: only starred workouts, no management.
  // The full library lives on its own page.
  async function refreshWorkoutList() {
    workoutListEl.innerHTML = '<li>Loading…</li>';
    try {
      // FTP tests live on Profile, even if one was starred before they moved.
      const workouts = (await listWorkouts()).filter((w) => w.starred && !w.test);
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
