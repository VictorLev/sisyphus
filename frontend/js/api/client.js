async function request(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${path} failed with ${res.status}`);
  }
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
