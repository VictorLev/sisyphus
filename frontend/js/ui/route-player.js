// A route's video and progress on the ride screen. The video sits where
// YouTube scenery would, muted, and is driven by the ride, not a clock:
// each frame its playback rate is set to the rider's speed times the
// route's seconds of video per metre, nudged toward where it should be,
// and it jumps there if it drifts by more than 2 s (a sprint, a stall, a
// slow network). Stopped or paused: the video stops. Below the video, the
// elevation profile shows how far along the rider is.

const MIN_RATE = 0.0625; // the slowest browsers allow; below it, pause
const MAX_RATE = 8;
const JUMP_S = 2;

export function createRoutePlayer({ frameEl, progressEl, format }) {
  let video = null;
  let track = null;
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
      progressEl.hidden = false;
      drawProfile();
      this.update({ distanceM: 0, speedKmh: 0, paused: true });
    },

    update({ distanceM, speedKmh, paused }) {
      if (!video) return;
      const d = Math.min(distanceM, track.distanceM);
      const finished = distanceM >= track.distanceM;
      const target = track.videoTimeAt(d);
      let rate = ((speedKmh ?? 0) / 3.6) * track.videoSecondsPerMetre(d);
      if (paused || finished || rate < MIN_RATE) {
        if (!video.paused) video.pause();
      } else {
        const drift = video.currentTime - target;
        if (Math.abs(drift) > JUMP_S && video.readyState >= 1) video.currentTime = target;
        else rate *= 1 - Math.max(-0.5, Math.min(0.5, drift * 0.25)); // ease back toward the right frame
        video.playbackRate = Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
        if (video.paused) video.play().catch(() => {});
      }
      if (finished && Math.abs(video.currentTime - target) > 0.5 && video.readyState >= 1) video.currentTime = target;

      const pct = (d / track.distanceM) * 100;
      marker.setAttribute('x1', pct * 10);
      marker.setAttribute('x2', pct * 10);
      progressEl.style.setProperty('--route-done', `${pct}%`);
      textEl.textContent = format({ doneM: d, totalM: track.distanceM, grade: track.gradeAt(d) });
    },

    pause() {
      video?.pause();
    },

    stop() {
      video?.remove();
      video = null;
      track = null;
      progressEl.hidden = true;
    },
  };
}
