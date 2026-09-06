// The rider's avatar during a ride: Sisyphus pushing the boulder, working
// harder the higher the power zone. Effort is expressed three ways at once
// — cadence of the animation, how far he leans into it, and how steep the
// slope becomes — so the difference between Z2 and Z5 is legible from the
// bike at a glance, not a subtle tell.

const GRID_W = 96;
const GRID_H = 34;
const PIXEL = 4;

const BOULDER = [
  '..XXXX..',
  '.XXXXXX.',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '..XXXX..',
];

// Upright: easy spinning, barely working.
const PUSHER_EASY = [
  '..XX..',
  '..XX..',
  '.XXXXX',
  'XXXX..',
  '.XXX..',
  '.XXX..',
  '.X.X..',
  '.X..X.',
  'X...X.',
];

// Braced low over the boulder: everything is going into it.
const PUSHER_HARD = [
  '......',
  '...XXX',
  '..XXXX',
  '.XXXXX',
  'XXXX..',
  'XXX...',
  'X.XX..',
  'X..XX.',
  'X...XX',
];

// Per-zone character. Slope and lean rise together; the frame interval
// falls, so he visibly labours faster under load.
const EFFORT = {
  1: { slope: 0.20, frameMs: 190, sprite: PUSHER_EASY },
  2: { slope: 0.32, frameMs: 165, sprite: PUSHER_EASY },
  3: { slope: 0.46, frameMs: 140, sprite: PUSHER_EASY },
  4: { slope: 0.60, frameMs: 115, sprite: PUSHER_HARD },
  5: { slope: 0.74, frameMs: 92, sprite: PUSHER_HARD },
  6: { slope: 0.90, frameMs: 70, sprite: PUSHER_HARD },
};

export function createRideHero(canvas) {
  canvas.width = GRID_W * PIXEL;
  canvas.height = GRID_H * PIXEL;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const styles = getComputedStyle(document.documentElement);
  const hillColor = styles.getPropertyValue('--color-bronze-dim').trim() || '#7a6340';

  let effort = EFFORT[2];
  let zoneColor = styles.getPropertyValue('--color-bronze-bright').trim() || '#e0c088';
  let step = 0;
  let timer = null;

  const groundRow = (x, slope) => {
    const rise = (GRID_H - 6) * slope;
    const y = Math.round(GRID_H - 3 - (x * rise) / (GRID_W - 1));
    return Math.max(1, Math.min(GRID_H - 1, y));
  };

  // Rest a sprite on the highest ground under its whole footprint, so
  // nothing floats over the slope's steps.
  const restRow = (sprite, x, slope) => {
    let highest = GRID_H;
    for (let i = 0; i < sprite[0].length; i++) {
      highest = Math.min(highest, groundRow(Math.max(0, Math.min(GRID_W - 1, x + i)), slope));
    }
    return highest - sprite.length;
  };

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

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { slope, sprite } = effort;

    for (let x = 0; x < GRID_W; x++) {
      for (let y = groundRow(x, slope); y < GRID_H; y++) px(x, y, hillColor);
    }

    // He never reaches the top: the loop resets and he begins again.
    const span = GRID_W - 22;
    const t = (step % 40) / 40;
    const x = Math.round(4 + t * span);
    blit(sprite, x, restRow(sprite, x, slope), zoneColor);
    blit(BOULDER, x + 7, restRow(BOULDER, x + 7, slope), zoneColor);
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => {
      step += 1;
      draw();
    }, effort.frameMs);
  }

  draw();
  schedule();

  return {
    // Called as the rider's zone changes; only re-times the loop when the
    // zone actually moves, so the animation never stutters mid-stride.
    setZone(zoneId, color) {
      const next = EFFORT[Math.max(1, Math.min(6, zoneId || 2))];
      if (color) zoneColor = color;
      if (next === effort) {
        draw();
        return;
      }
      effort = next;
      schedule();
      draw();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
