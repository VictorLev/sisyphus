import { createWorkout, updateWorkout } from '../api/client.js';
import { ZONES, zoneForWatts, zoneRangeLabel, estimatedLoad } from '../zones.js';
import { showView } from '../ui/views.js';
import { t, num, label as translateLabel } from '../i18n.js';

const segmentLabel = (label, index) => (label ? translateLabel(label) : t('live.segmentN', { n: index + 1 }));
const pctText = (pct) => t('unit.pctFtp', { n: num(pct, Number.isInteger(pct) ? 0 : 1) });

export function initBuilder({ onSaved }) {
  const nameInput = document.getElementById('workout-name');
  const segmentList = document.getElementById('segment-list');
  const labelInput = document.getElementById('segment-label');
  const durationInput = document.getElementById('segment-duration');
  const pctInput = document.getElementById('segment-pct');
  const gradeInput = document.getElementById('segment-grade');
  const addBtn = document.getElementById('add-segment-btn');
  const saveBtn = document.getElementById('save-workout-btn');
  const cancelBtn = document.getElementById('cancel-builder-btn');
  const titleEl = document.getElementById('builder-title');
  const chartEl = document.getElementById('preview-chart');
  const axisEl = document.getElementById('preview-axis');
  const timeEl = document.getElementById('preview-time');
  const pickerEl = document.getElementById('zone-picker');
  const durationEl = document.getElementById('builder-duration');
  const countEl = document.getElementById('builder-count');
  const loadEl = document.getElementById('builder-load');

  let ftp = null;

  function setFtp(value) {
    ftp = value > 0 ? value : null;
    renderZonePicker();
    render();
    updatePctHint();
  }

  // The watts the typed % means for this rider, under the input.
  const pctHintEl = document.getElementById('segment-pct-watts');
  function updatePctHint() {
    const w = wattsAt(Number(pctInput.value));
    pctHintEl.textContent = w != null && Number.isFinite(w) ? t('builder.wattsAtFtp', { watts: w, ftp }) : '\u00a0';
  }
  pctInput.addEventListener('input', updatePctHint);

  function clock(totalSec) {
    const s = Math.round(totalSec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // Targets are % of FTP, so a workout fits every rider and keeps fitting as
  // FTP changes; the watts shown are the current rider's, for reference.
  const round1 = (n) => Math.round(n * 10) / 10;
  const wattsAt = (pct) => (ftp ? Math.round((pct / 100) * ftp) : null);
  const pctForZone = (zone) => {
    const top = Number.isFinite(zone.max) ? zone.max : zone.min + 0.25;
    return Math.round(((zone.min + top) / 2) * 100);
  };

  // Zone buttons append a segment at the middle of the band, so a session
  // can be sketched by intensity before any numbers are typed.
  function renderZonePicker() {
    pickerEl.innerHTML = '';
    for (const zone of ZONES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'zone-btn';
      btn.style.setProperty('--zone-color', zone.color);
      const zoneLabel = t(`zone.${zone.id}`);
      btn.innerHTML = `<strong>${zone.name}</strong><em>${zoneRangeLabel(zone)}</em><span></span>`;
      btn.querySelector('span').textContent = zoneLabel;
      btn.title = ftp
        ? t('builder.zoneTitleWatts', { zone: zoneLabel, pct: pctForZone(zone), watts: wattsAt(pctForZone(zone)), ftp })
        : t('builder.zoneTitle', { zone: zoneLabel, pct: pctForZone(zone) });
      btn.addEventListener('click', () => {
        segments.push({
          duration_sec: Number(durationInput.value) || 300,
          target_ftp_pct: pctForZone(zone),
          label: zoneLabel,
          grade_percent: 0,
        });
        render();
      });
      pickerEl.appendChild(btn);
    }
  }

  // Bars are proportional in both axes: width by duration, height by % FTP
  // against the workout's own peak, with the zone boundaries as gridlines.
  function renderPreview() {
    const totalSec = segments.reduce((sum, seg) => sum + seg.duration_sec, 0);
    durationEl.textContent = clock(totalSec);
    countEl.textContent = String(segments.length);
    const load = estimatedLoad(segments, ftp);
    loadEl.textContent = load == null ? '—' : String(load);

    axisEl.innerHTML = '';
    const peak = Math.max(1, ...segments.map((seg) => seg.target_ftp_pct));
    const ceiling = Math.max(peak * 1.1, 130);
    for (const zone of ZONES.slice(1)) {
      const pct = zone.min * 100;
      if (pct > ceiling) continue;
      const line = document.createElement('span');
      line.className = 'axis-line';
      line.style.bottom = `${(pct / ceiling) * 100}%`;
      line.textContent = zone.name;
      axisEl.appendChild(line);
    }

    chartEl.innerHTML = '';
    if (segments.length === 0) {
      chartEl.innerHTML = '';
      const empty = document.createElement('p');
      empty.className = 'preview-empty';
      empty.textContent = t('builder.empty');
      chartEl.appendChild(empty);
      timeEl.innerHTML = '';
      return;
    }

    segments.forEach((seg, index) => {
      const zone = zoneForWatts(seg.target_ftp_pct, 100);
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'preview-bar';
      bar.style.flex = `${seg.duration_sec} 0 0`;
      bar.style.height = `${Math.max(4, (seg.target_ftp_pct / ceiling) * 100)}%`;
      bar.style.background = zone.color;
      const grade = seg.grade_percent ?? 0;
      const w = wattsAt(seg.target_ftp_pct);
      bar.title = `${segmentLabel(seg.label, index)}: ${pctText(seg.target_ftp_pct)}${w != null ? ` (≈${w} W)` : ''} (${zone.name})` +
        `, ${seg.duration_sec} s${grade ? `, ${t('builder.gradeShort', { grade: `${grade > 0 ? '+' : ''}${grade}` })}` : ''}\n${t('builder.clickToRemove')}`;
      if (grade) {
        const marker = document.createElement('i');
        marker.className = grade > 0 ? 'bar-grade up' : 'bar-grade down';
        marker.textContent = grade > 0 ? '▲' : '▼';
        bar.appendChild(marker);
      }
      bar.addEventListener('click', () => {
        segments.splice(index, 1);
        render();
      });
      chartEl.appendChild(bar);
    });

    // A few evenly spaced time ticks along the session.
    timeEl.innerHTML = '';
    for (let i = 0; i <= 4; i++) {
      const tick = document.createElement('span');
      tick.textContent = clock((totalSec / 4) * i).slice(0, 5);
      timeEl.appendChild(tick);
    }
  }

  let segments = [];
  let editingId = null; // set when editing an existing workout

  // Loading a workout turns the builder into an editor; Save then PUTs
  // rather than creating a duplicate.
  function loadWorkout(workout) {
    editingId = workout?.id ?? null;
    // Stored workouts are % FTP; a stray watts segment is converted at the
    // rider's FTP so the builder only ever edits percentages.
    segments = workout
      ? workout.structure.map(({ target_watts, ...seg }) => (
        target_watts === undefined ? { ...seg } : { ...seg, target_ftp_pct: round1((target_watts / (ftp || 200)) * 100) }
      ))
      : [];
    nameInput.value = workout?.name ?? '';
    titleEl.textContent = t(workout ? 'builder.editTitle' : 'builder.title');
    saveBtn.textContent = t(workout ? 'builder.saveChanges' : 'builder.save');
    render();
  }

  function render() {
    renderPreview();
    segmentList.innerHTML = '';
    segments.forEach((segment, index) => {
      const li = document.createElement('li');
      li.className = 'segment-row';
      const label = document.createElement('span');
      label.className = 'segment-row-label';
      label.textContent = segment.label ? segmentLabel(segment.label, index) : t('builder.untitled');
      const detail = document.createElement('span');
      detail.className = 'segment-row-detail';
      const grade = segment.grade_percent ?? 0;
      const terrain = grade > 0 ? ` ▲${grade}%` : grade < 0 ? ` ▼${Math.abs(grade)}%` : '';
      const w = wattsAt(segment.target_ftp_pct);
      detail.textContent = `${segment.duration_sec} s @ ${pctText(segment.target_ftp_pct)}${w != null ? ` (≈${w} W)` : ''}${terrain}`;
      li.appendChild(label);
      li.appendChild(detail);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary';
      removeBtn.textContent = t('builder.remove');
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
    editingId = null;
    titleEl.textContent = t('builder.title');
    saveBtn.textContent = t('builder.save');
    nameInput.value = '';
    labelInput.value = '';
    durationInput.value = '300';
    pctInput.value = '75';
    updatePctHint();
    gradeInput.value = '0';
    render();
  }

  addBtn.addEventListener('click', () => {
    const duration_sec = parseInt(durationInput.value, 10);
    const target_ftp_pct = round1(Number(pctInput.value));
    const label = labelInput.value.trim();

    if (!Number.isInteger(duration_sec) || duration_sec <= 0) {
      alert(t('builder.badDuration'));
      return;
    }
    if (!Number.isFinite(target_ftp_pct) || target_ftp_pct < 0 || target_ftp_pct > 300) {
      alert(t('builder.badTarget'));
      return;
    }

    const grade_percent = Number(gradeInput.value) || 0;
    if (grade_percent < -20 || grade_percent > 20) {
      alert(t('builder.badGrade'));
      return;
    }
    segments.push({ duration_sec, target_ftp_pct, label, grade_percent });
    labelInput.value = '';
    render();
  });

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      alert(t('builder.needName'));
      return;
    }
    if (segments.length === 0) {
      alert(t('builder.needSegment'));
      return;
    }

    try {
      if (editingId) await updateWorkout(editingId, { name, structure: segments });
      else await createWorkout({ name, structure: segments });
      reset();
      onSaved?.();
      showView('home');
    } catch (err) {
      alert(t('builder.saveFailed', { error: err.message }));
    }
  });

  cancelBtn.addEventListener('click', () => {
    reset();
    showView('home');
  });

  renderZonePicker();
  render();
  return { loadWorkout, reset, setFtp };
}
