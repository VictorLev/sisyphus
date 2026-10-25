// The Routes page: filmed roads to ride. Each card has the distance, the
// climbing, the video's length and a small elevation profile, and Start.
// An admin also imports routes (a route file and its video) and deletes
// them. The video goes up in 32 MB pieces with a progress bar; an upload
// that stopped resumes from where the server says it got to, once the same
// file is picked again.

import { listRoutes, createRoute, deleteRoute, setRouteStarred } from '../api/client.js';
import { t, tp, num, language } from '../i18n.js';
import { card, routeProfileSvg, iconButton } from './cards.js';
import { shrinkImage } from './image-resize.js';

// A route's card picture: shrunk, then sent. Resolves to the updated route.
export async function uploadThumbnail(routeId, file) {
  const blob = await shrinkImage(file);
  const res = await fetch(`/api/routes/${routeId}/thumbnail`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `upload failed (${res.status})`);
  return body;
}

const CHUNK = 32 * 1024 * 1024;

const km = (m) => `${num(m / 1000, 1)} km`;
// "45 s", "11 min", "1 h 54".
const minutes = (s) => {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

// The route's name in the rider's language, from its route file's metadata
// when it has one.
export const routeName = (route) => (language() === 'fr' && route.meta?.title_fr) || route.name;

// Where it is: "Moab, USA" (or just the country), '' if not known.
export const routePlace = (route) => [route.meta?.city, route.meta?.country].filter(Boolean).join(', ');

// "Moab, USA · 35.9 km · ↑ 812 m · ≈ 1 h 54", shared with the Home picker.
// The route file's own distance, climbing and riding time win over what
// the app works out from the road and the video.
export const routeMeta = (route) => {
  const meta = route.meta ?? {};
  return [
    routePlace(route),
    meta.distance_km != null ? `${num(meta.distance_km, 1)} km` : km(route.distance_m),
    t('routes.ascent', { m: num(meta.elevation_gain_m ?? route.ascent_m) }),
    meta.eta_min != null ? t('routes.eta', { time: minutes(meta.eta_min * 60) }) : t('routes.video', { time: minutes(route.duration_s) }),
  ].filter(Boolean).join(' · ');
};

// Sends file from offset on, in pieces; onProgress(bytesDone).
async function uploadVideo(routeId, file, offset, onProgress) {
  let at = offset;
  while (at < file.size) {
    const res = await fetch(`/api/routes/${routeId}/video?offset=${at}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file.slice(at, Math.min(file.size, at + CHUNK)),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && Number.isInteger(body.video_received)) {
      at = body.video_received; // the server has more (or less) than we thought
    } else if (!res.ok) {
      throw new Error(body.error || `upload failed (${res.status})`);
    } else {
      at = body.video_received;
    }
    onProgress(at);
  }
}

export function initRoutes({ isAdmin, onStartRoute }) {
  const listEl = document.getElementById('route-list');
  const summaryEl = document.getElementById('routes-summary');
  const importPanel = document.getElementById('route-import');
  const form = document.getElementById('route-import-form');
  const statusEl = document.getElementById('route-import-status');
  const bar = document.getElementById('route-import-progress');
  importPanel.hidden = !isAdmin;
  let busy = false;

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? 'var(--color-error)' : '';
  }

  function showProgress(done, total) {
    bar.hidden = false;
    bar.max = total;
    bar.value = done;
    setStatus(t('routes.uploading', { pct: Math.floor((done / total) * 100), done: num(done / 1e6, 0), total: num(total / 1e6, 0) }));
  }

  async function sendVideo(route, file) {
    busy = true;
    try {
      showProgress(route.video_received, route.video_size);
      await uploadVideo(route.id, file, route.video_received, (done) => showProgress(done, route.video_size));
      setStatus(t('routes.imported', { name: routeName(route) }));
      form.reset();
    } catch (err) {
      setStatus(t('routes.uploadStopped', { error: err.message }), true);
    } finally {
      busy = false;
      bar.hidden = true;
      refresh();
    }
  }

  // An unfinished upload: pick the same video again to carry on.
  function resume(route) {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'video/mp4,video/*';
    picker.onchange = () => {
      const file = picker.files[0];
      if (!file) return;
      if (file.size !== route.video_size) {
        setStatus(t('routes.wrongFile', { size: num(route.video_size / 1e6, 0) }), true);
        return;
      }
      sendVideo(route, file);
    };
    picker.click();
  }

  function routeCard(route) {
    const { li, actions } = card({
      graph: routeProfileSvg(route.profile),
      image: route.thumbnail,
      title: routeName(route),
      meta: routeMeta(route),
      starred: route.starred,
      onToggleStar: async () => {
        await setRouteStarred(route.id, !route.starred);
        refresh();
      },
    });
    li.classList.add('route-card');
    if (route.ready) {
      actions.append(iconButton('start', t('workouts.start'), () => onStartRoute(route), { primary: true }));
    } else {
      const pending = document.createElement('span');
      pending.className = 'hint';
      pending.textContent = t('routes.notReady', { pct: Math.floor((route.video_received / route.video_size) * 100) });
      actions.append(pending);
      if (isAdmin) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'secondary';
        more.textContent = t('routes.resume');
        more.addEventListener('click', () => !busy && resume(route));
        actions.append(more);
      }
    }
    if (isAdmin) {
      // Add or replace the card's picture.
      const pic = iconButton('picture', t('routes.picture'), () => {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'image/*';
        picker.onchange = async () => {
          if (!picker.files[0]) return;
          try {
            await uploadThumbnail(route.id, picker.files[0]);
            refresh();
          } catch (err) {
            setStatus(err.message, true);
          }
        };
        picker.click();
      });
      actions.append(pic);
      const del = iconButton('delete', t('workouts.delete'), async () => {
        if (!confirm(t('routes.confirmDelete', { name: routeName(route) }))) return;
        await deleteRoute(route.id);
        refresh();
      });
      actions.append(del);
    }
    return li;
  }

  async function refresh() {
    let routes;
    try {
      routes = await listRoutes();
    } catch (err) {
      summaryEl.textContent = err.message;
      return;
    }
    summaryEl.textContent = tp('routes.count', routes.length);
    listEl.innerHTML = '';
    if (routes.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = t(isAdmin ? 'routes.emptyAdmin' : 'routes.empty');
      listEl.append(empty);
    }
    for (const route of routes) listEl.append(routeCard(route));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const routeFile = document.getElementById('route-import-file').files[0];
    const video = document.getElementById('route-import-video').files[0];
    const picture = document.getElementById('route-import-picture').files[0];
    const name = document.getElementById('route-import-name').value.trim();
    if (!routeFile || !video) return; // the name may come from the route file
    let route;
    try {
      route = await createRoute({ name, route: await routeFile.text(), video_size: video.size });
    } catch (err) {
      setStatus(err.message, true);
      return;
    }
    // The picture first: it's small, and the card looks right at once.
    if (picture) {
      try {
        Object.assign(route, await uploadThumbnail(route.id, picture));
      } catch (err) {
        setStatus(err.message, true);
      }
    }
    refresh();
    sendVideo(route, video);
  });

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'routes') refresh();
  });
  return { refresh };
}
