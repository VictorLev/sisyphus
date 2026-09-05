import { getProfile, saveProfile, getSettings, saveSettings } from '../api/client.js';
import { showView } from './views.js';

// Generic form binding for the profile and settings pages. Both are the same
// shape — load a JSON document, edit named fields, save it back — so they
// share one implementation rather than two near-identical modules.
function bindForm({ fields, load, save, statusEl, onSaved }) {
  const inputs = new Map(fields.map((id) => [id, document.getElementById(id)]));

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#d98c6a' : '';
  }

  async function populate() {
    try {
      const data = await load();
      for (const [id, input] of inputs) {
        const key = id.replace(/^(profile|setting)-/, '').replace(/-/g, '_');
        if (data[key] !== undefined) input.value = data[key];
      }
      setStatus('');
      return data;
    } catch (err) {
      setStatus(`Could not load: ${err.message}`, true);
      return null;
    }
  }

  async function submit() {
    const body = {};
    for (const [id, input] of inputs) {
      const key = id.replace(/^(profile|setting)-/, '').replace(/-/g, '_');
      body[key] = input.type === 'number' ? Number(input.value) : input.value;
    }
    try {
      const saved = await save(body);
      setStatus('Saved.');
      onSaved?.(saved);
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  return { populate, submit };
}

export function initProfile() {
  const form = bindForm({
    fields: ['profile-name', 'profile-ftp', 'profile-weight-kg', 'profile-max-hr'],
    load: getProfile,
    save: saveProfile,
    statusEl: document.getElementById('profile-status'),
    onSaved: (saved) => document.dispatchEvent(new CustomEvent('profilechange', { detail: saved })),
  });

  document.getElementById('save-profile-btn').addEventListener('click', () => form.submit());
  document.getElementById('profile-back-btn').addEventListener('click', () => showView('home'));
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'profile') form.populate();
  });
  return form;
}

export function initSettings({ onSaved }) {
  const form = bindForm({
    fields: [
      'setting-gear-count',
      'setting-min-resistance',
      'setting-max-resistance',
      'setting-start-gear',
      'setting-power-smoothing-sec',
      'setting-sample-interval-sec',
      'setting-default-mode',
    ],
    load: getSettings,
    save: saveSettings,
    statusEl: document.getElementById('settings-status'),
    onSaved,
  });

  document.getElementById('save-settings-btn').addEventListener('click', () => form.submit());
  document.getElementById('settings-back-btn').addEventListener('click', () => showView('home'));
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'settings') form.populate();
  });
  return form;
}
