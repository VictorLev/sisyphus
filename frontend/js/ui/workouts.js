import { listWorkouts, deleteWorkout, setWorkoutStarred, copyWorkout, createWorkout, getProfile } from '../api/client.js';
import { toCsv, toZwo, parseWorkoutFile, fileSlug } from '../workout/files.js';
import { t, tp } from '../i18n.js';
import { workoutName } from '../workout/names.js';
import { showView } from './views.js';
import { card, workoutGraphSvg, iconButton } from './cards.js';

function totalMinutes(workout) {
  return Math.round(workout.structure.reduce((sum, s) => sum + s.duration_sec, 0) / 60);
}

// A workout as a card: its power graph, name, duration and the star, then
// Start and (on the Workouts page) management. Library workouts are shared
// and read-only, so they get Copy instead of Edit and Delete. `compact`
// cards (the Home pickers) only start and star.
export function renderWorkoutRow(workout, { onStart, onEdit, onDelete, onCopy, onExport, onToggleStar, compact }) {
  const grades = workout.structure.filter((s) => s.grade_percent);
  const { li, actions } = card({
    graph: workoutGraphSvg(workout.structure),
    title: workoutName(workout),
    meta: `${totalMinutes(workout)} min · ${tp('workouts.segments', workout.structure.length)}` +
      (grades.length ? ` · ${t('workouts.withTerrain', { n: grades.length })}` : ''),
    // Only where library and own workouts are mixed (the Home pickers).
    tag: compact && workout.library ? t('workouts.library') : null,
    starred: workout.starred,
    onToggleStar: onToggleStar ? () => onToggleStar(workout) : null,
  });
  li.classList.add('workout-card');

  const button = (icon, label, handler, primary = false) =>
    actions.append(iconButton(icon, label, () => handler(workout), { primary }));

  button('start', t('workouts.start'), onStart, true);
  if (!compact && workout.library) {
    button('copy', t('workouts.copy'), onCopy);
  } else if (!compact) {
    button('edit', t('workouts.edit'), onEdit);
    button('delete', t('workouts.delete'), onDelete);
  }
  if (!compact && onExport) button('export', t('workouts.exportTitle'), onExport);
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
