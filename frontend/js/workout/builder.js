import { createWorkout } from '../api/client.js';
import { showView } from '../ui/views.js';

export function initBuilder({ onSaved }) {
  const nameInput = document.getElementById('workout-name');
  const segmentList = document.getElementById('segment-list');
  const labelInput = document.getElementById('segment-label');
  const durationInput = document.getElementById('segment-duration');
  const wattsInput = document.getElementById('segment-watts');
  const addBtn = document.getElementById('add-segment-btn');
  const saveBtn = document.getElementById('save-workout-btn');
  const cancelBtn = document.getElementById('cancel-builder-btn');

  let segments = [];

  function render() {
    segmentList.innerHTML = '';
    segments.forEach((segment, index) => {
      const li = document.createElement('li');
      li.className = 'segment-row';
      li.innerHTML = `
        <span class="segment-row-label">${segment.label || '(untitled)'}</span>
        <span class="segment-row-detail">${segment.duration_sec}s @ ${segment.target_watts}W</span>
      `;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        segments.splice(index, 1);
        render();
      });
      li.appendChild(removeBtn);
      segmentList.appendChild(li);
    });
  }

  function reset() {
    segments = [];
    nameInput.value = '';
    labelInput.value = '';
    durationInput.value = '300';
    wattsInput.value = '150';
    render();
  }

  addBtn.addEventListener('click', () => {
    const duration_sec = parseInt(durationInput.value, 10);
    const target_watts = parseInt(wattsInput.value, 10);
    const label = labelInput.value.trim();

    if (!Number.isInteger(duration_sec) || duration_sec <= 0) {
      alert('Duration must be a positive number of seconds.');
      return;
    }
    if (!Number.isInteger(target_watts) || target_watts < 0) {
      alert('Target watts must be zero or a positive number.');
      return;
    }

    segments.push({ duration_sec, target_watts, label });
    labelInput.value = '';
    render();
  });

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      alert('Give the workout a name.');
      return;
    }
    if (segments.length === 0) {
      alert('Add at least one segment.');
      return;
    }

    try {
      await createWorkout({ name, structure: segments });
      reset();
      onSaved?.();
      showView('home');
    } catch (err) {
      alert(`Could not save workout: ${err.message}`);
    }
  });

  cancelBtn.addEventListener('click', () => {
    reset();
    showView('home');
  });

  render();
}
