// Minimal canvas charts. No charting library — the project has no bundler,
// and these two shapes (a power trace and weekly bars) are all the Chronicle
// needs.

function palette() {
  const s = getComputedStyle(document.documentElement);
  const get = (name, fallback) => s.getPropertyValue(name).trim() || fallback;
  return {
    line: get('--color-bronze-bright', '#e0c088'),
    fill: 'rgba(176, 141, 87, 0.18)',
    grid: get('--color-stone', '#3a3632'),
    text: get('--color-text-dim', '#9a9188'),
    accent: get('--color-bronze', '#b08d57'),
  };
}

// Sizes the backing store to the element's CSS box times the device pixel
// ratio, so lines stay sharp on high-DPI screens.
function prepare(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function niceCeil(value) {
  if (value <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / mag) * mag;
}

// Long rides carry thousands of samples; more than one point per pixel is
// wasted work, so bucket down to the available width taking each bucket's
// max (peaks matter more than averages on a power trace).
function downsample(points, targetCount) {
  if (points.length <= targetCount) return points;
  const bucket = points.length / targetCount;
  const out = [];
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(points.length, Math.floor((i + 1) * bucket));
    let best = points[start];
    for (let j = start; j < end; j++) {
      if (points[j] && best && points[j].y > best.y) best = points[j];
    }
    if (best) out.push(best);
  }
  return out;
}

export function drawPowerChart(canvas, samples, { targetSeries = null } = {}) {
  const { ctx, width, height } = prepare(canvas);
  const c = palette();
  const pad = { top: 12, right: 12, bottom: 24, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const points = samples
    .filter((s) => s.power != null)
    .map((s) => ({ x: s.timestamp_offset_sec, y: s.power }));

  if (points.length === 0 || plotW <= 0 || plotH <= 0) {
    ctx.fillStyle = c.text;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('No power data', pad.left, height / 2);
    return;
  }

  const xMax = points[points.length - 1].x || 1;
  const peak = Math.max(...points.map((p) => p.y), ...(targetSeries ?? []).map((t) => t.watts));
  const yMax = niceCeil(peak * 1.1);

  const sx = (x) => pad.left + (x / xMax) * plotW;
  const sy = (y) => pad.top + plotH - (y / yMax) * plotH;

  // Horizontal gridlines with watt labels.
  ctx.strokeStyle = c.grid;
  ctx.fillStyle = c.text;
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const watts = (yMax / 4) * i;
    const y = Math.round(sy(watts)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(watts)), 6, y + 4);
  }

  // Target steps behind the trace, so over/under is visible at a glance.
  if (targetSeries?.length) {
    ctx.strokeStyle = c.accent;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    targetSeries.forEach((seg, i) => {
      const y = sy(seg.watts);
      if (i === 0) ctx.moveTo(sx(seg.startSec), y);
      else ctx.lineTo(sx(seg.startSec), y);
      ctx.lineTo(sx(seg.endSec), y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const plot = downsample(points, Math.max(2, Math.floor(plotW)));

  // Filled area under the trace.
  ctx.beginPath();
  ctx.moveTo(sx(plot[0].x), sy(0));
  plot.forEach((p) => ctx.lineTo(sx(p.x), sy(p.y)));
  ctx.lineTo(sx(plot[plot.length - 1].x), sy(0));
  ctx.closePath();
  ctx.fillStyle = c.fill;
  ctx.fill();

  ctx.beginPath();
  plot.forEach((p, i) => (i === 0 ? ctx.moveTo(sx(p.x), sy(p.y)) : ctx.lineTo(sx(p.x), sy(p.y))));
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Time axis: start and end only, to stay uncluttered.
  ctx.fillStyle = c.text;
  const mins = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  ctx.fillText('0:00', pad.left, height - 8);
  const endLabel = mins(xMax);
  ctx.fillText(endLabel, pad.left + plotW - ctx.measureText(endLabel).width, height - 8);
}

export function drawWeeklyChart(canvas, weeks) {
  const { ctx, width, height } = prepare(canvas);
  const c = palette();
  const pad = { top: 12, right: 12, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (weeks.length === 0 || plotW <= 0) {
    ctx.fillStyle = c.text;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('No rides yet', pad.left, height / 2);
    return;
  }

  const yMax = niceCeil(Math.max(...weeks.map((w) => w.minutes), 1));
  const slot = plotW / weeks.length;
  const barW = Math.max(4, slot * 0.6);

  ctx.strokeStyle = c.grid;
  ctx.fillStyle = c.text;
  ctx.font = '11px system-ui, sans-serif';
  for (let i = 0; i <= 3; i++) {
    const minutes = (yMax / 3) * i;
    const y = Math.round(pad.top + plotH - (minutes / yMax) * plotH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(minutes)), 6, y + 4);
  }

  weeks.forEach((week, i) => {
    const h = (week.minutes / yMax) * plotH;
    const x = pad.left + i * slot + (slot - barW) / 2;
    ctx.fillStyle = c.line;
    ctx.fillRect(x, pad.top + plotH - h, barW, h);
    ctx.fillStyle = c.text;
    const label = week.label;
    const tw = ctx.measureText(label).width;
    if (tw < slot) ctx.fillText(label, x + barW / 2 - tw / 2, height - 8);
  });
}
