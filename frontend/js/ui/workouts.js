import { listWorkouts, deleteWorkout, setWorkoutStarred, copyWorkout } from '../api/client.js';
import { showView } from './views.js';

const STAR_ON = '★';
const STAR_OFF = '☆';

function totalMinutes(workout) {
  return Math.round(workout.structure.reduce((sum, s) => sum + s.duration_sec, 0) / 60);
}

// Shared row renderer: the home screen shows only starred workouts with a
// Start button, the Workouts page shows everything with full management.
// Library workouts are shared and read-only, so they get Copy instead of
// Edit and Delete.
export function renderWorkoutRow(workout, { onStart, onEdit, onDelete, onCopy, onToggleStar, compact }) {
  const li = document.createElement('li');

  const info = document.createElement('div');
  const name = document.createElement('span');
  name.className = 'workout-name';
  name.textContent = workout.name;
  const meta = document.createElement('span');
  meta.className = 'workout-meta';
  const grades = workout.structure.filter((s) => s.grade_percent);
  meta.textContent = `${workout.structure.length} segments · ${totalMinutes(workout)} min` +
    (grades.length ? ` · ${grades.length} with terrain` : '') +
    (workout.test ? ' · measures your FTP' : '');
  info.appendChild(name);
  if (workout.library && compact) {
    const tag = document.createElement('span');
    tag.className = 'workout-tag';
    tag.textContent = 'Library';
    info.appendChild(tag);
  }
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

  if (!compact && workout.library) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary';
    copyBtn.textContent = 'Copy to My Workouts';
    copyBtn.addEventListener('click', () => onCopy(workout));
    actions.appendChild(copyBtn);
  } else if (!compact) {
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
  const libraryEl = document.getElementById('library-list');
  const summaryEl = document.getElementById('workouts-summary');

  async function refresh() {
    let workouts;
    try {
      workouts = await listWorkouts();
    } catch (err) {
      summaryEl.textContent = `Could not load workouts: ${err.message}`;
      return;
    }

    const own = workouts.filter((w) => !w.library);
    const library = workouts.filter((w) => w.library);
    const starred = workouts.filter((w) => w.starred).length;
    summaryEl.textContent =
      `${own.length} of your own · ${library.length} in the library · ${starred} on the home screen`;

    listEl.innerHTML = '';
    libraryEl.innerHTML = '';
    if (own.length === 0) {
      listEl.innerHTML = '<li class="empty">Nothing here yet. Build one, or copy one from the library.</li>';
    }
    for (const workout of workouts) {
      const target = workout.library ? libraryEl : listEl;
      target.appendChild(renderWorkoutRow(workout, {
        onStart: onStartRide,
        onEdit: onEditWorkout,
        // Copy, then open the copy in the builder: editing is why it was copied.
        onCopy: async (w) => {
          try {
            const copy = await copyWorkout(w.id);
            onLibraryChanged?.();
            onEditWorkout(copy);
          } catch (err) {
            alert(`Could not copy: ${err.message}`);
          }
        },
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
