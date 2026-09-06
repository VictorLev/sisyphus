import { listWorkouts, deleteWorkout } from '../api/client.js';
import { showView } from './views.js';

export function initHome({ trainerConnection, onStartRide, onEditWorkout }) {
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
        const info = document.createElement('div');
        const name = document.createElement('span');
        name.className = 'workout-name';
        name.textContent = workout.name;
        const meta = document.createElement('span');
        meta.className = 'workout-meta';
        meta.textContent = `${workout.structure.length} segments · ${Math.round(totalSec / 60)} min`;
        info.appendChild(name);
        info.appendChild(meta);
        li.appendChild(info);
        const actions = document.createElement('div');
        actions.className = 'row-actions';

        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.textContent = 'Start';
        startBtn.addEventListener('click', () => onStartRide(workout));

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'secondary';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => onEditWorkout(workout));

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'secondary';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete "${workout.name}"? Rides that used it keep their history.`)) return;
          try {
            await deleteWorkout(workout.id);
            refreshWorkoutList();
          } catch (err) {
            alert(`Could not delete: ${err.message}`);
          }
        });

        actions.appendChild(startBtn);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        li.appendChild(actions);
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
