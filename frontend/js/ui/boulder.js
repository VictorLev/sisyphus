// Pixel-art boulder that rolls up an incline as a workout segment
// progresses. Canvas-based (no image assets) — a small logical pixel grid
// blitted via fillRect, scaled up with crisp edges. Driven externally by
// setProgress(fraction), called once per rAF tick from app.js; no internal
// timer, so it can't drift out of sync with the workout runner.

const PIXEL = 4;
const GRID_W = 40;
const GRID_H = 15;
const BOULDER_SIZE = 6;

// 0 = transparent, 1 = base, 2 = highlight. Two frames swapped by progress
// to fake a rolling texture without a second animated element.
const FRAME_A = [
  [0, 1, 1, 1, 1, 0],
  [1, 1, 2, 1, 1, 1],
  [1, 2, 1, 1, 1, 1],
  [1, 1, 1, 1, 2, 1],
  [1, 1, 1, 2, 1, 1],
  [0, 1, 1, 1, 1, 0],
];
const FRAME_B = [
  [0, 1, 1, 1, 1, 0],
  [1, 1, 1, 2, 1, 1],
  [1, 1, 1, 1, 2, 1],
  [1, 2, 1, 1, 1, 1],
  [1, 1, 2, 1, 1, 1],
  [0, 1, 1, 1, 1, 0],
];

function inclineY(x) {
  return Math.round((GRID_H - 1) - (x * (GRID_H - 1)) / (GRID_W - 1));
}

export function createBoulder(canvasEl) {
  const ctx = canvasEl.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  canvasEl.style.imageRendering = 'pixelated';

  const styles = getComputedStyle(document.documentElement);
  const stoneColor = styles.getPropertyValue('--color-stone').trim() || '#3a3632';
  const bronzeColor = styles.getPropertyValue('--color-bronze').trim() || '#b08d57';
  const highlightColor = '#e0c088';

  function drawPixel(gx, gy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(gx * PIXEL, gy * PIXEL, PIXEL, PIXEL);
  }

  function drawIncline() {
    for (let x = 0; x < GRID_W; x++) {
      const y = inclineY(x);
      for (let fy = y; fy < GRID_H; fy++) {
        drawPixel(x, fy, stoneColor);
      }
    }
  }

  function drawBoulder(fraction) {
    const frame = Math.floor(fraction * 20) % 2 === 0 ? FRAME_A : FRAME_B;
    const bx = Math.round(fraction * (GRID_W - BOULDER_SIZE));
    const groundY = inclineY(Math.min(bx + BOULDER_SIZE - 1, GRID_W - 1));
    const by = groundY - BOULDER_SIZE + 1;

    for (let row = 0; row < BOULDER_SIZE; row++) {
      for (let col = 0; col < BOULDER_SIZE; col++) {
        const cell = frame[row][col];
        if (cell === 0) continue;
        drawPixel(bx + col, by + row, cell === 2 ? highlightColor : bronzeColor);
      }
    }
  }

  function setProgress(fraction) {
    const clamped = Math.max(0, Math.min(1, fraction));
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    drawIncline();
    drawBoulder(clamped);
  }

  setProgress(0);
  return { setProgress };
}
