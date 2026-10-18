import { listWorkouts, deleteWorkout, setWorkoutStarred, copyWorkout, createWorkout, getProfile } from '../api/client.js';
import { toCsv, toZwo, parseWorkoutFile, fileSlug } from '../workout/files.js';
import { t, tp } from '../i18n.js';
import { workoutName } from '../workout/names.js';
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
export function renderWorkoutRow(workout, { onStart, onEdit, onDelete, onCopy, onExport, onToggleStar, compact }) {
  const li = document.createElement('li');

  const info = document.createElement('div');
  const name = document.createElement('span');
  name.className = 'workout-name';
  name.textContent = workoutName(workout);
  const meta = document.createElement('span');
  meta.className = 'workout-meta';
  const grades = workout.structure.filter((s) => s.grade_percent);
  meta.textContent = `${tp('workouts.segments', workout.structure.length)} · ${totalMinutes(workout)} min` +
    (grades.length ? ` · ${grades.length} with terrain` : '');
  info.appendChild(name);
  if (workout.library && compact) {
    const tag = document.createElement('span');
    tag.className = 'workout-tag';
    tag.textContent = t('workouts.library');
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
    star.title = t(workout.starred ? 'workouts.unstar' : 'workouts.star');
    star.setAttribute('aria-label', star.title);
    star.addEventListener('click', () => onToggleStar(workout));
    actions.appendChild(star);
  }

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.textContent = t('workouts.start');
  startBtn.addEventListener('click', () => onStart(workout));
  actions.appendChild(startBtn);

  if (!compact && workout.library) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary';
    copyBtn.textContent = t('workouts.copy');
    copyBtn.addEventListener('click', () => onCopy(workout));
    actions.appendChild(copyBtn);
  } else if (!compact) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary';
    editBtn.textContent = t('workouts.edit');
    editBtn.addEventListener('click', () => onEdit(workout));
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'secondary';
    delBtn.textContent = t('workouts.delete');
    delBtn.addEventListener('click', () => onDelete(workout));
    actions.appendChild(delBtn);
  }

  if (!compact && onExport) {
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'secondary';
    exportBtn.textContent = t('workouts.export');
    exportBtn.title = t('workouts.exportTitle');
    exportBtn.addEventListener('click', () => onExport(workout));
    actions.appendChild(exportBtn);
  }

  li.appendChild(actions);
  return li;
}

// Hands the browser a file to save.
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportWorkout(workout, format) {
  if (format === 'zwo') download(`${fileSlug(workout.name)}.zwo`, toZwo(workout), 'application/xml');
  else download(`${fileSlug(workout.name)}.csv`, toCsv(workout), 'text/csv');
}

export function initWorkouts({ onStartRide, onEditWorkout, onLibraryChanged }) {
  const listEl = document.getElementById('workouts-list');
  const libraryEl = document.getElementById('library-list');
  const summaryEl = document.getElementById('workouts-summary');
  const formatEl = document.getElementById('workout-file-format');
  const statusEl = document.getElementById('workout-files-status');
  const fileInput = document.getElementById('import-workouts-input');
  let ownWorkouts = [];

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--color-error)' : '';
  }

  // Remembered per browser: whoever exports .zwo usually always does.
  try { formatEl.value = localStorage.getItem('sisyphus.workoutFileFormat') || 'csv'; } catch { /* storage off */ }
  formatEl.addEventListener('change', () => {
    try { localStorage.setItem('sisyphus.workoutFileFormat', formatEl.value); } catch { /* storage off */ }
  });

  document.getElementById('export-all-btn').addEventListener('click', () => {
    if (ownWorkouts.length === 0) {
      setStatus(t('workouts.nothingToExport'), true);
      return;
    }
    if (formatEl.value === 'zwo') {
      // A .zwo holds one workout, so this is one file each (Chrome may ask
      // once to allow several downloads).
      ownWorkouts.forEach((w, i) => setTimeout(() => exportWorkout(w, 'zwo'), i * 250));
      setStatus(tp('workouts.exportingZwo', ownWorkouts.length));
    } else {
      download('sisyphus-workouts.csv', toCsv(ownWorkouts), 'text/csv');
      setStatus(tp('workouts.exportedCsv', ownWorkouts.length));
    }
  });

  document.getElementById('import-workouts-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = ''; // choosing the same file again must fire again
    if (files.length === 0) return;
    let ftp = 200;
    try { ftp = (await getProfile()).ftp || 200; } catch { /* default FTP for any watts column */ }

    const imported = [];
    const problems = [];
    for (const file of files) {
      try {
        const workouts = parseWorkoutFile(file.name, await file.text(), { ftp });
        for (const w of workouts) {
          await createWorkout(w);
          imported.push(w.name);
        }
      } catch (err) {
        problems.push(`${file.name}: ${err.message}`);
      }
    }
    if (imported.length) {
      await refresh();
      onLibraryChanged?.();
    }
    const done = imported.length
      ? tp('workouts.imported', imported.length, { names: imported.join(', ') })
      : '';
    setStatus([done, ...problems].filter(Boolean).join(' '), problems.length > 0);
  });


  async function refresh() {
    let workouts;
    try {
      workouts = await listWorkouts();
    } catch (err) {
      summaryEl.textContent = t('workouts.loadFailed', { error: err.message });
      return;
    }

    // FTP tests are started from Profile, not listed with the workouts.
    workouts = workouts.filter((w) => !w.test);
    const own = workouts.filter((w) => !w.library);
    ownWorkouts = own;
    const library = workouts.filter((w) => w.library);
    const starred = workouts.filter((w) => w.starred).length;
    summaryEl.textContent = t('workouts.summary', { own: own.length, library: library.length, starred });

    listEl.innerHTML = '';
    libraryEl.innerHTML = '';
    if (own.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t('workouts.empty');
      listEl.append(empty);
    }
    for (const workout of workouts) {
      const target = workout.library ? libraryEl : listEl;
      target.appendChild(renderWorkoutRow(workout, {
        onStart: onStartRide,
        onEdit: onEditWorkout,
        onExport: (w) => exportWorkout(w, formatEl.value),
        // Copy, then open the copy in the builder: editing is why it was copied.
        onCopy: async (w) => {
          try {
            const copy = await copyWorkout(w.id);
            onLibraryChanged?.();
            onEditWorkout(copy);
          } catch (err) {
            alert(t('workouts.copyFailed', { error: err.message }));
          }
        },
        onToggleStar: async (w) => {
          await setWorkoutStarred(w.id, !w.starred);
          await refresh();
          onLibraryChanged?.();
        },
        onDelete: async (w) => {
          if (!confirm(t('workouts.confirmDelete', { name: w.name }))) return;
          try {
            await deleteWorkout(w.id);
            await refresh();
            onLibraryChanged?.();
          } catch (err) {
            alert(t('workouts.deleteFailed', { error: err.message }));
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
