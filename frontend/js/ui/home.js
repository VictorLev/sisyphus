import { listWorkouts } from '../api/client.js';
import { showView } from './views.js';

export function initHome({ trainerConnection, onStartRide }) {
  const connectBtn = document.getElementById('connect-btn');
  const statusEl = document.getElementById('connection-status');
  const freeRideBtn = document.getElementById('free-ride-btn');
  const workoutListEl = document.getElementById('workout-list');
  const newWorkoutBtn = document.getElementById('new-workout-btn');

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
