import { getProfile, saveProfile, getSettings, saveSettings } from '../api/client.js';
import { t } from '../i18n.js';
import { initSceneryEditor } from './scenery-editor.js';

// Generic form binding for the profile and settings pages. Both are the same
// shape — load a JSON document, edit named fields, save it back — so they
// share one implementation rather than two near-identical modules.
// beforeSubmit may return an error message to stop the save; afterLoad gets
// the loaded document, for fields that are more than one input.
function bindForm({ fields, load, save, statusEl, onSaved, beforeSubmit, afterLoad }) {
  const inputs = new Map(fields.map((id) => [id, document.getElementById(id)]));

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--color-error)' : '';
  }

  async function populate() {
    try {
      const data = await load();
      for (const [id, input] of inputs) {
        const key = id.replace(/^(profile|setting)-/, '').replace(/-/g, '_');
        if (data[key] === undefined) continue;
        if (input.type === 'checkbox') input.checked = Boolean(data[key]);
        else input.value = data[key];
      }
      afterLoad?.(data);
      setStatus('');
      return data;
    } catch (err) {
      setStatus(t('common.loadFailed', { error: err.message }), true);
      return null;
    }
  }

  async function submit() {
    const problem = beforeSubmit?.();
    if (problem) {
      setStatus(problem, true);
      return false;
    }
    const body = {};
    for (const [id, input] of inputs) {
      const key = id.replace(/^(profile|setting)-/, '').replace(/-/g, '_');
      body[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    }
    try {
      const saved = await save(body);
      setStatus(t('common.saved'));
      onSaved?.(saved);
      return true;
    } catch (err) {
      setStatus(err.message, true);
      return false;
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
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'profile') form.populate();
  });
  return form;
}

export function initSettings({ onSaved }) {
  const scenery = initSceneryEditor();
  const form = bindForm({
    fields: [
      'setting-gear-count',
      'setting-min-resistance',
      'setting-max-resistance',
      'setting-start-gear',
      'setting-resistance-per-grade',
      'setting-power-smoothing-sec',
      'setting-sample-interval-sec',
      'setting-bike-weight-kg',
      'setting-default-mode',
      'setting-scenery-videos',
      'setting-scenery-mode',
      'setting-language',
      'setting-theme',
      'setting-strava-export',
    ],
    load: getSettings,
    save: saveSettings,
    statusEl: document.getElementById('settings-status'),
    onSaved,
    beforeSubmit: () => scenery.commit(),
    afterLoad: (data) => scenery.load(data.scenery_videos),
  });

  // The Save button stays quiet (outlined) until a setting changes, then
  // fills in so it's clear there's something to save.
  const saveBtn = document.getElementById('save-settings-btn');
  const statusEl = document.getElementById('settings-status');
  const setDirty = (dirty) => saveBtn.classList.toggle('secondary', !dirty);
  setDirty(false);
  const onEdit = (event) => {
    const target = event.target;
    // Only the settings themselves: not the password fields or the log.
    if (!target.id?.startsWith('setting-') && !target.closest?.('.scenery-editor')) return;
    if (saveBtn.classList.contains('secondary')) statusEl.textContent = '';
    setDirty(true);
  };
  const view = document.querySelector('[data-view="settings"]');
  view.addEventListener('input', onEdit);
  view.addEventListener('change', onEdit);

  saveBtn.addEventListener('click', async () => {
    if (await form.submit()) setDirty(false);
  });
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'settings') form.populate().then(() => setDirty(false));
  });
  return form;
}
