// A route's video and progress on the ride screen. The video sits where
// YouTube scenery would, muted, and is driven by the ride, not a clock:
// its playback rate follows the rider's speed times the route's seconds of
// video per metre, smoothed so the browser isn't asked for a new rate every
// frame (that stutters), eased toward where it should be, and it jumps
// there if it drifts by more than 2 s (a sprint, a stall, a slow network).
// Stopped or paused: the video stops. Below the video, the elevation
// profile shows how far along the rider is, against an altitude scale.
//
// Slowed down, a 30 fps video shows only ~16 new frames a second at 0.55x
// and steps. Below 0.9x the video is drawn on a canvas instead, each new
// frame fading in over the old one for as long as a frame lasts (frame
// blending), which turns the steps into a smooth dissolve. Needs
// requestVideoFrameCallback (Chrome, Edge, Safari); without it, the video
// plays as is.

const MIN_RATE = 0.0625; // the slowest browsers allow; below it, pause
const MAX_RATE = 8;
const JUMP_S = 2;
const SMOOTHING_S = 0.8; // how quickly the rate follows the rider's speed
const RATE_STEP = 0.02; // change the video's rate only when off by more than 2%
const BLEND_BELOW = 0.9; // blend frames when slower than this
const MAX_CANVAS_PX = 1600; // blending at most this wide, whatever the screen

// Draws src over the whole canvas the way object-fit: cover does.
function drawCover(ctx, src, sw, sh) {
  const { width: cw, height: ch } = ctx.canvas;
  const scale = Math.max(cw / sw, ch / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(src, (cw - w) / 2, (ch - h) / 2, w, h);
}

function frameBlender(video, frameEl) {
  if (typeof video.requestVideoFrameCallback !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'route-video route-blend';
  canvas.hidden = true;
  frameEl.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  // The frame before and the newest frame, kept at canvas size.
  const prev = document.createElement('canvas');
  const curr = document.createElement('canvas');
  let frameAt = 0;
  let frameLen = 1000 / 30;
  let lastMediaTime = null;
  let on = false;
  let raf = null;
  let stopped = false;

  function fit() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(MAX_CANVAS_PX, Math.round(frameEl.clientWidth * ratio));
    const h = Math.round((w / Math.max(1, frameEl.clientWidth)) * frameEl.clientHeight);
    for (const c of [canvas, prev, curr]) {
      if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
    }
  }

  function onFrame(now, meta) {
    if (stopped) return;
    if (on && video.videoWidth) {
      fit();
      prev.getContext('2d').drawImage(curr, 0, 0);
      drawCover(curr.getContext('2d'), video, video.videoWidth, video.videoHeight);
      // How long this frame will be on screen: the media time it covers,
      // stretched by the playback rate.
      if (lastMediaTime != null && meta.mediaTime > lastMediaTime) {
        frameLen = Math.min(500, ((meta.mediaTime - lastMediaTime) * 1000) / Math.max(MIN_RATE, video.playbackRate));
      }
      frameAt = now;
    }
    lastMediaTime = meta.mediaTime;
    video.requestVideoFrameCallback(onFrame);
  }
  video.requestVideoFrameCallback(onFrame);

  function paint(now) {
    if (!on || stopped) return;
    const alpha = Math.min(1, Math.max(0, (now - frameAt) / frameLen));
    ctx.globalAlpha = 1;
    ctx.drawImage(prev, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(curr, 0, 0);
    raf = requestAnimationFrame(paint);
  }

  return {
    set(blend) {
      if (blend === on) return;
      on = blend;
      canvas.hidden = !on;
      video.style.visibility = on ? 'hidden' : '';
      if (on) {
        fit();
        // Start from the frame on screen, not black.
        if (video.videoWidth) {
          drawCover(curr.getContext('2d'), video, video.videoWidth, video.videoHeight);
          prev.getContext('2d').drawImage(curr, 0, 0);
        }
        raf = requestAnimationFrame(paint);
      } else if (raf) {
        cancelAnimationFrame(raf);
      }
    },
    get on() {
      return on;
    },
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}

export function createRoutePlayer({ frameEl, progressEl, format }) {
  let video = null;
  let track = null;
  let blender = null;
  let smoothRate = 0;
  let lastUpdate = null;
  const marker = progressEl.querySelector('.route-marker');
  const done = progressEl.querySelector('.route-done');
  const textEl = progressEl.querySelector('.route-progress-text');

  function drawProfile() {
    const alts = track.profile(200);
    const min = Math.min(...alts);
    const range = Math.max(10, Math.max(...alts) - min);
    const pts = alts.map((a, i) => `${((i / (alts.length - 1)) * 1000).toFixed(1)},${(98 - ((a - min) / range) * 90).toFixed(1)}`).join(' ');
    progressEl.querySelector('.route-line').setAttribute('points', pts);
    progressEl.querySelector('.route-area').setAttribute('points', `0,100 ${pts} 1000,100`);
    done.setAttribute('points', `0,100 ${pts} 1000,100`);
    // The scale's ends line up with the profile's: min at 98%, min + range at 8%.
    progressEl.querySelector('.route-axis-max').textContent = `${Math.round(min + range)} m`;
    progressEl.querySelector('.route-axis-min').textContent = `${Math.round(min)} m`;
  }

  return {
    start(route, routeTrack) {
      track = routeTrack;
      video = document.createElement('video');
      video.className = 'route-video';
      video.src = `/api/routes/${route.id}/video`;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      frameEl.appendChild(video);
      blender = frameBlender(video, frameEl);
      smoothRate = 0;
      lastUpdate = null;
      progressEl.hidden = false;
      drawProfile();
      this.update({ distanceM: 0, speedKmh: 0, paused: true });
    },

    update({ distanceM, speedKmh, paused }) {
      if (!video) return;
      const now = performance.now();
      const dt = lastUpdate == null ? 0 : Math.min(1, (now - lastUpdate) / 1000);
      lastUpdate = now;
      const d = Math.min(distanceM, track.distanceM);
      const finished = distanceM >= track.distanceM;
      const target = track.videoTimeAt(d);
      const wanted = ((speedKmh ?? 0) / 3.6) * track.videoSecondsPerMetre(d);

      if (paused || finished || wanted < MIN_RATE) {
        smoothRate = 0;
        if (!video.paused) video.pause();
      } else {
        const drift = video.currentTime - target;
        if (Math.abs(drift) > JUMP_S && video.readyState >= 1) {
          video.currentTime = target;
          smoothRate = wanted;
        } else {
          // Ease back toward the right frame, gently enough not to be seen.
          const corrected = wanted * (1 - Math.max(-0.3, Math.min(0.3, drift * 0.15)));
          smoothRate = smoothRate === 0 ? corrected : smoothRate + (corrected - smoothRate) * Math.min(1, dt / SMOOTHING_S);
        }
        const rate = Math.max(MIN_RATE, Math.min(MAX_RATE, smoothRate));
        if (Math.abs(rate - video.playbackRate) > video.playbackRate * RATE_STEP) video.playbackRate = rate;
        if (video.paused) video.play().catch(() => {});
      }
      if (finished && Math.abs(video.currentTime - target) > 0.5 && video.readyState >= 1) video.currentTime = target;
      blender?.set(!video.paused && video.playbackRate < BLEND_BELOW);

      const pct = (d / track.distanceM) * 100;
      marker.setAttribute('x1', pct * 10);
      marker.setAttribute('x2', pct * 10);
      progressEl.style.setProperty('--route-done', `${pct}%`);
      textEl.textContent = format({ doneM: d, totalM: track.distanceM, grade: track.gradeAt(d), altM: track.altitudeAt(d) });
    },

    // For the ride screen's checks and tests.
    get blending() {
      return Boolean(blender?.on);
    },

    pause() {
      video?.pause();
      blender?.set(false);
    },

    stop() {
      blender?.stop();
      blender = null;
      video?.remove();
      video = null;
      track = null;
      progressEl.hidden = true;
    },
  };
}
