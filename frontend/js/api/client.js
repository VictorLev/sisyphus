async function request(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    // fetch rejects with a bare "Failed to fetch" for any network-level
    // failure, which reads like data loss when the shell is being served
    // from the service worker cache and only the API is unreachable. Say
    // what is actually wrong instead.
    throw new Error(
      `Cannot reach the Sisyphus server at ${window.location.host}. ` +
      'It may not be running, or this page may be open on an old port — ' +
      'your data is safe in the database either way.'
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${path} failed with ${res.status}`);
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
