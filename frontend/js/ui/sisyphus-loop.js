// Pixel-art Sisyphus, looping forever: he pushes the boulder up the slope,
// it escapes near the top, rolls back down, and he begins again.
//
// Canvas-based like the ride boulder (ui/boulder.js) — a small logical pixel
// grid blitted with fillRect and scaled up crisply, so no image assets are
// needed and it stays sharp at any size.

// Sprites as rows of characters: X = solid, anything else = transparent.
const BOULDER = [
  '.XXXX.',
  'XXXXXX',
  'XXXXXX',
  'XXXXXX',
  'XXXXXX',
  '.XXXX.',
];

// Facing right, leaning into the boulder with both arms extended.
const PUSHER = [
  '..XX..',
  '..XX..',
  '.XXXXX',
  'XXXX..',
  '.XXX..',
  '.XXX..',
  '.X.X..',
  'X...X.',
];

const GRID_W = 64;
const GRID_H = 22;
const PIXEL = 3;
const FRAMES = 48;
const FRAME_MS = 90;

const PUSH_END = 0.78; // most of the cycle is the climb
const START_X = 4;
const TOP_X = GRID_W - 14;

// The slope rises to the right.
const groundRow = (x) => GRID_H - 2 - Math.round((x * (GRID_H - 10)) / (GRID_W - 1));

// Rest a sprite on the highest ground beneath its footprint, so it never
// floats over the slope's steps.
function restRow(sprite, x) {
  let highest = GRID_H;
  for (let i = 0; i < sprite[0].length; i++) {
    highest = Math.min(highest, groundRow(Math.max(0, Math.min(GRID_W - 1, x + i))));
  }
  return highest - sprite.length;
}

export function initSisyphusLoop() {
  const canvas = document.getElementById('sisyphus-canvas');
  if (!canvas) return;

  canvas.width = GRID_W * PIXEL;
  canvas.height = GRID_H * PIXEL;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const styles = getComputedStyle(document.documentElement);
  const figureColor = styles.getPropertyValue('--color-bronze-bright').trim() || '#e0c088';
  const hillColor = styles.getPropertyValue('--color-bronze-dim').trim() || '#7a6340';

  const px = (x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * PIXEL, y * PIXEL, PIXEL, PIXEL);
  };

  const blit = (sprite, ox, oy, color) => {
    sprite.forEach((row, ry) => {
      [...row].forEach((cell, rx) => {
        if (cell !== 'X') return;
        const x = ox + rx;
        const y = oy + ry;
        if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H) px(x, y, color);
      });
    });
  };

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // The slope, drawn as a filled mass in the dimmer tone so the figure
    // stays the brightest thing in the frame.
    for (let x = 0; x < GRID_W; x++) {
      for (let y = groundRow(x); y < GRID_H; y++) px(x, y, hillColor);
    }

    if (t < PUSH_END) {
      const p = t / PUSH_END;
      const x = Math.round(START_X + p * (TOP_X - START_X));
      blit(PUSHER, x, restRow(PUSHER, x), figureColor);
      blit(BOULDER, x + 7, restRow(BOULDER, x + 7), figureColor);
    } else {
      // The boulder gets away and rolls back down past him.
      const p = (t - PUSH_END) / (1 - PUSH_END);
      const bx = Math.round(TOP_X + 7 - p * (TOP_X - START_X));
      blit(BOULDER, bx, restRow(BOULDER, bx), figureColor);
      blit(PUSHER, TOP_X, restRow(PUSHER, TOP_X), figureColor);
    }
  }

  // A reduced-motion preference gets a single static frame.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    draw(0.4);
    return;
  }

  let step = 0;
  draw(0);
  setInterval(() => {
    step = (step + 1) % FRAMES;
    draw(step / FRAMES);
  }, FRAME_MS);
}
