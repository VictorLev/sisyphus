import { logEvent } from '../log.js';
import { t } from '../i18n.js';

async function request(path, options) {
  const method = options?.method ?? 'GET';
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    logEvent('error', `${method} ${path}: the server could not be reached`);
    // fetch rejects with a bare "Failed to fetch" for any network-level
    // failure, which reads like data loss when the shell is being served
    // from the service worker cache and only the API is unreachable. Say
    // what is actually wrong instead.
    throw new Error(t('error.unreachable', { host: window.location.host }));
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    // Not logged in, or the session ran out. The login screen opens over
    // whatever is on screen (ui/login.js listens for this) rather than
    // navigating away, so a ride being saved at that moment is parked by
    // the caller's error handling, not thrown away with the page.
    logEvent('warn', `${method} ${path}: 401, not logged in (session ended?)`);
    window.dispatchEvent(new CustomEvent('sisyphus:unauthorized'));
    throw new Error(t('error.notLoggedIn'));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // A 401 from the auth routes is an answer (logged out, wrong password),
    // not a fault; everything else is worth keeping.
    if (!(res.status === 401 && path.startsWith('/api/auth/'))) {
      logEvent(res.status >= 500 ? 'error' : 'warn', `${method} ${path}: ${res.status} ${body.error ?? ''}`.trim());
    }
    // Known errors have a code and a translation; others keep the server's text.
    const message = body.code ? t(`error.${body.code}`, { minutes: body.minutes ?? '' }) : null;
    const err = new Error(message && !message.startsWith('error.') ? message : body.error || `${path} failed with ${res.status}`);
    err.status = res.status;
    err.code = body.code ?? null;
    throw err;
  }
  // DELETE replies 204 with no body.
  if (res.status === 204) return null;
  return res.json();
}

export function listWorkouts() {
  return request('/api/workouts');
}

export function getWorkout(id) {
  return request(`/api/workouts/${id}`);
}

export function createWorkout(body) {
  return request('/api/workouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createSession(body) {
  return request('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getProfile() {
  return request('/api/profile');
}

export function saveProfile(body) {
  return request('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getSettings() {
  return request('/api/settings');
}

export function saveSettings(body) {
  return request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function listSessions() {
  return request('/api/sessions');
}

export function getSession(id) {
  return request(`/api/sessions/${id}`);
}

export function deleteSession(id) {
  return request(`/api/sessions/${id}`, { method: 'DELETE' });
}

export function getRecords() {
  return request('/api/records');
}

export function updateWorkout(id, body) {
  return request(`/api/workouts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteWorkout(id) {
  return request(`/api/workouts/${id}`, { method: 'DELETE' });
}

export function setWorkoutStarred(id, starred) {
  return request(`/api/workouts/${id}/starred`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ starred }),
  });
}

export function getLevel() {
  return request('/api/level');
}

export function copyWorkout(id) {
  return request(`/api/workouts/${id}/copy`, { method: 'POST' });
}

// Resolves to the logged-in user, or null when nobody is logged in.
export async function getMe() {
  try {
    return await request('/api/auth/me');
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}

export function login(username, password) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return request('/api/auth/logout', { method: 'POST' });
}

export function changePassword(currentPassword, newPassword) {
  return request('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

// FTP tests: the estimate a test ride measured, setting the FTP (optionally
// from that test ride), and the rider's FTP history.
export function getFtpEstimate(sessionId) {
  return request(`/api/ftp/estimate/${sessionId}`);
}

export function setFtp(ftp, sessionId = null) {
  return request('/api/ftp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ftp, session_id: sessionId }),
  });
}

export function getFtpHistory() {
  return request('/api/ftp/history');
}

export function getBadges() {
  return request('/api/badges');
}

// Everyone's totals for this week or month, in the viewer's time zone.
export function getLeaderboard(period) {
  const tz = -new Date().getTimezoneOffset();
  return request(`/api/leaderboard?period=${encodeURIComponent(period)}&tz=${tz}`);
}

// The rider's title and/or description of a ride (to paste into Strava).
export function setSessionText(id, fields) {
  return request(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
}

// Routes: filmed roads to ride. The video is uploaded and streamed
// separately (ui/routes.js, /api/routes/:id/video).
export function listRoutes() {
  return request('/api/routes');
}

export function getRoute(id) {
  return request(`/api/routes/${id}`);
}

export function createRoute(body) {
  return request('/api/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteRoute(id) {
  return request(`/api/routes/${id}`, { method: 'DELETE' });
}

export function setRouteStarred(id, starred) {
  return request(`/api/routes/${id}/starred`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ starred }),
  });
}

// The shop: drachmas, cosmetics, what's worn.
export function getShop() {
  return request('/api/shop');
}

export function getWallet() {
  return request('/api/shop/me');
}

export function buyItem(itemId) {
  return request('/api/shop/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  });
}

export function equipItem(slot, itemId) {
  return request('/api/shop/equip', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, item_id: itemId }),
  });
}
