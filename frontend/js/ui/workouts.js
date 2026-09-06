import { listWorkouts, deleteWorkout, setWorkoutStarred } from '../api/client.js';
import { showView } from './views.js';

const STAR_ON = '★';
const STAR_OFF = '☆';

function totalMinutes(workout) {
  return Math.round(workout.structure.reduce((sum, s) => sum + s.duration_sec, 0) / 60);
}

// Shared row renderer: the home screen shows only starred workouts with a
// Start button, the library shows everything with full management.
export function renderWorkoutRow(workout, { onStart, onEdit, onDelete, onToggleStar, compact }) {
  const li = document.createElement('li');

  const info = document.createElement('div');
  const name = document.createElement('span');
  name.className = 'workout-name';
  name.textContent = workout.name;
  const meta = document.createElement('span');
  meta.className = 'workout-meta';
  const grades = workout.structure.filter((s) => s.grade_percent);
  meta.textContent = `${workout.structure.length} segments · ${totalMinutes(workout)} min` +
    (grades.length ? ` · ${grades.length} with terrain` : '');
  info.appendChild(name);
  info.appendChild(meta);
  li.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  if (onToggleStar) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = `secondary star-btn${workout.starred ? ' is-starred' : ''}`;
    star.textContent = workout.starred ? STAR_ON : STAR_OFF;
    star.title = workout.starred ? 'Remove from home screen' : 'Show on home screen';
    star.setAttribute('aria-label', star.title);
    star.addEventListener('click', () => onToggleStar(workout));
    actions.appendChild(star);
  }

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.textContent = 'Start';
  startBtn.addEventListener('click', () => onStart(workout));
  actions.appendChild(startBtn);

  if (!compact) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => onEdit(workout));
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'secondary';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => onDelete(workout));
    actions.appendChild(delBtn);
  }

  li.appendChild(actions);
  return li;
}

export function initWorkouts({ onStartRide, onEditWorkout, onLibraryChanged }) {
  const listEl = document.getElementById('workouts-list');
  const summaryEl = document.getElementById('workouts-summary');

  async function refresh() {
    let workouts;
    try {
      workouts = await listWorkouts();
    } catch (err) {
      summaryEl.textContent = `Could not load workouts: ${err.message}`;
      return;
    }

    const starred = workouts.filter((w) => w.starred).length;
    summaryEl.textContent = workouts.length === 0
      ? 'No workouts yet.'
      : `${workouts.length} workout${workouts.length > 1 ? 's' : ''} · ${starred} on the home screen`;

    listEl.innerHTML = '';
    if (workouts.length === 0) {
      listEl.innerHTML = '<li class="empty">Nothing here yet. Build one.</li>';
      return;
    }
    for (const workout of workouts) {
      listEl.appendChild(renderWorkoutRow(workout, {
        onStart: onStartRide,
        onEdit: onEditWorkout,
        onToggleStar: async (w) => {
          await setWorkoutStarred(w.id, !w.starred);
          await refresh();
          onLibraryChanged?.();
        },
        onDelete: async (w) => {
          if (!confirm(`Delete "${w.name}"? Rides that used it keep their history.`)) return;
          try {
            await deleteWorkout(w.id);
            await refresh();
            onLibraryChanged?.();
          } catch (err) {
            alert(`Could not delete: ${err.message}`);
          }
        },
      }));
    }
  }

  document.getElementById('new-workout-btn').addEventListener('click', () => showView('builder'));
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'workouts') refresh();
  });

  return { refresh };
}
