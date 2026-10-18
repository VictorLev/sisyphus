// Scenery: a YouTube virtual ride playing in the centre of the ride screen.
// The rider lists videos in Settings (a name and a link per row, saved as
// "Swiss Alps | https://youtu.be/..., ..."), and each ride starts on one
// picked at random or on the next one in order. With no list, the default
// ride plays. The player is a plain embed driven over postMessage
// (enablejsapi), so no YouTube script is loaded here.

import { t } from '../i18n.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// New accounts start with it (backend/src/routes/config.js has the same
// link), and an empty list falls back to it.
export const DEFAULT_SCENERY_LINK = 'https://www.youtube.com/watch?v=D6tC1pyrsTM&list=PLiNcRO_l_QWfhgFUDiBBaJ5NEF7xyfb_f&t=60s';
export const SCENERY_MODES = ['random', 'sequence'];

// "90", "90s", "1m30s", "1h2m3s" -> seconds.
function parseStart(value) {
  if (!value) return 0;
  if (/^\d+s?$/.test(value)) return parseInt(value, 10);
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  const [, h = 0, m = 0, s = 0] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// Accepts the usual link shapes (watch, youtu.be, embed, live, shorts) and
// keeps a start time if the link has one. Returns null for anything else.
export function parseYouTube(link) {
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:embed|live|shorts)\/([^/]+)/)?.[1] ?? null;
  }
  if (!id || !ID_PATTERN.test(id)) return null;
  return { id, start: parseStart(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}

// Videos separated by commas (newlines too, so lists saved one per line
// before keep working); text around a link becomes its name. Entries
// without a usable YouTube link are skipped rather than failing the list.
export function parseSceneryList(text) {
  const videos = [];
  for (const row of sceneryRows(text)) {
    const video = parseYouTube(row.link);
    if (!video) continue;
    videos.push({ ...video, name: row.name || t('scenery.n', { n: videos.length + 1 }) });
  }
  return videos;
}

// The saved text as editor rows ({ name, link }), unnamed ones with an
// empty name. Anything without a link is dropped.
export function sceneryRows(text) {
  const rows = [];
  for (const line of String(text ?? '').split(/[,\n]/)) {
    const link = line.match(/https?:\/\/\S+/)?.[0];
    if (!link) continue;
    rows.push({ name: line.replace(link, '').replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, ''), link });
  }
  return rows;
}

// Editor rows back to the saved text. Commas and bars would split a name,
// so they become dashes.
export function serializeSceneryRows(rows) {
  return rows
    .map(({ name = '', link = '' }) => ({ name: name.replace(/\s*[,|]\s*/g, ' - ').trim(), link: link.trim() }))
    .filter((row) => row.link)
    .map((row) => (row.name ? `${row.name} | ${row.link}` : row.link))
    .join(', ');
}

function embedUrl({ id, start }) {
  const params = new URLSearchParams({
    autoplay: '1',
    // Muted, so autoplay is never blocked; the player's own control unmutes.
    mute: '1',
    controls: '1',
    rel: '0',
    playsinline: '1',
    enablejsapi: '1',
    origin: location.origin,
    // loop only works with a playlist of the video itself.
    loop: '1',
    playlist: id,
  });
  if (start > 0) params.set('start', String(start));
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}

// A random video for this ride. With two or more, never the one that played
// last time, so "random" doesn't hand you the same view twice running.
export function pickScenery(videos, lastId = null, random = Math.random) {
  if (videos.length === 0) return null;
  const pool = videos.length > 1 ? videos.filter((v) => v.id !== lastId) : videos;
  return pool[Math.floor(random() * pool.length)] ?? pool[0];
}

// In order: the one after the video that played last time, wrapping
// around; the first when there's no last one (or it left the list).
export function nextScenery(videos, lastId = null) {
  if (videos.length === 0) return null;
  const i = videos.findIndex((v) => v.id === lastId);
  return videos[(i + 1) % videos.length];
}

const CHOICE_KEY = 'sisyphus.scenery';

function rememberedChoice() {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function rememberChoice(id) {
  try {
    localStorage.setItem(CHOICE_KEY, id);
  } catch { /* a convenience only */ }
}

export function initScenery({ frameEl, pickerEl, emptyEl }) {
  let videos = [];
  let mode = 'random';
  let iframe = null;

  function command(func) {
    iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
  }

  function load(video) {
    rememberChoice(video.id);
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.title = t('settings.sceneryTitle');
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      // YouTube refuses embeds that arrive without a referrer.
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      frameEl.appendChild(iframe);
    }
    iframe.src = embedUrl(video);
  }

  function renderPicker() {
    pickerEl.innerHTML = '';
    for (const video of videos) {
      const option = document.createElement('option');
      option.value = video.id;
      option.textContent = video.name;
      pickerEl.appendChild(option);
    }
    // A picker with one entry is just noise.
    pickerEl.hidden = videos.length < 2;
  }

  pickerEl.addEventListener('change', () => {
    const video = videos.find((v) => v.id === pickerEl.value);
    if (video) load(video);
  });

  return {
    // From saved settings; takes effect at the next ride start.
    setList(text, order = 'random') {
      videos = parseSceneryList(text);
      if (videos.length === 0) videos = parseSceneryList(DEFAULT_SCENERY_LINK);
      mode = SCENERY_MODES.includes(order) ? order : 'random';
      renderPicker();
    },

    start() {
      emptyEl.hidden = videos.length > 0;
      if (videos.length === 0) return;
      const last = rememberedChoice();
      const video = mode === 'sequence' ? nextScenery(videos, last) : pickScenery(videos, last);
      pickerEl.value = video.id;
      load(video);
    },

    pause() {
      command('pauseVideo');
    },

    play() {
      command('playVideo');
    },

    // Ride over: unload the player entirely so nothing plays behind Home.
    stop() {
      iframe?.remove();
      iframe = null;
    },
  };
}
