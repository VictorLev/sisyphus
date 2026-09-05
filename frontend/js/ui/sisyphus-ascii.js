// The little man himself, rendered as ASCII and looping forever: he pushes
// the boulder up the slope, it gets away near the top, rolls back down, and
// he starts again. Decorative chrome only — deliberately NOT shown on the
// live ride screen, which stays data-only.

const W = 20;
const H = 7;
const FRAMES = 24;
const FRAME_MS = 180;

// Hill rising to the right, as a stepped slope.
const groundRow = (x) => Math.max(1, H - 1 - Math.round((x * (H - 2)) / (W - 1)));

function renderFrame(t) {
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  for (let x = 0; x < W; x++) grid[groundRow(x)][x] = '_';

  const put = (x, y, ch) => {
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = ch;
  };

  const PUSH_END = 0.78; // most of the cycle is the climb
  const TOP = W - 4;

  if (t < PUSH_END) {
    const p = t / PUSH_END;
    const bx = Math.round(3 + p * (TOP - 3));
    // Anchor the rider to the boulder's ground row so the pair never
    // detaches across the slope's steps.
    const y = groundRow(bx) - 1;
    put(bx, y, 'O');
    put(bx - 1, y, '/');
    put(bx - 2, y, 'o');
  } else {
    // The boulder escapes and rolls back down; he watches it go.
    const p = (t - PUSH_END) / (1 - PUSH_END);
    const bx = Math.round(TOP - p * (TOP - 3));
    put(bx, groundRow(bx) - 1, 'O');
    const px = TOP - 2;
    const py = groundRow(px) - 1;
    put(px, py, 'o');
    put(px + 1, py, p < 0.5 ? '|' : '\\');
  }

  return grid.map((row) => row.join('').replace(/\s+$/, '')).join('\n');
}

export function initSisyphusAscii() {
  const el = document.getElementById('sisyphus-ascii');
  if (!el) return;

  // Honour a reduced-motion preference: show a single static frame instead
  // of looping.
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    el.textContent = renderFrame(0.4);
    return;
  }

  let step = 0;
  el.textContent = renderFrame(0);
  setInterval(() => {
    step = (step + 1) % FRAMES;
    el.textContent = renderFrame(step / FRAMES);
  }, FRAME_MS);

  // Keep the ride screen free of animation.
  document.addEventListener('viewchange', (event) => {
    el.hidden = event.detail.view === 'live';
  });
}
