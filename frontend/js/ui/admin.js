// The Admin Panel (admins only, from Settings): riders (create, delete,
// reset a password), the shared scenery, and the release notes. A new or
// reset password is shown once, with a Copy button, to pass on.

import {
  adminListUsers, adminCreateUser, adminResetPassword, adminUserData, adminDeleteUser,
  adminGetScenery, adminSetScenery, adminReleases,
} from '../api/client.js';
import { t, num, date } from '../i18n.js';
import { initSceneryEditor } from './scenery-editor.js';

export function initAdmin({ onSceneryChange }) {
  const ridersEl = document.getElementById('admin-riders');
  const ridersStatus = document.getElementById('admin-riders-status');
  const passwordBox = document.getElementById('admin-password');
  const sceneryStatus = document.getElementById('admin-scenery-status');
  let scenery = null;

  const say = (el, text, isError = false) => {
    el.textContent = text;
    el.style.color = isError ? 'var(--color-error)' : '';
  };

  function showPassword(message, password) {
    document.getElementById('admin-password-text').textContent = message;
    document.getElementById('admin-password-value').textContent = password;
    passwordBox.hidden = false;
  }
  document.getElementById('admin-password-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('admin-password-value').textContent);
      say(ridersStatus, t('admin.copied'));
    } catch { /* select it by hand */ }
  });

  function button(label, onClick, secondary = true) {
    const b = document.createElement('button');
    b.type = 'button';
    if (secondary) b.className = 'secondary';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  async function refreshRiders() {
    let users;
    try {
      users = await adminListUsers();
    } catch (err) {
      say(ridersStatus, err.message, true);
      return;
    }
    ridersEl.innerHTML = '';
    for (const u of users) {
      const tr = document.createElement('tr');
      const who = document.createElement('td');
      const name = document.createElement('strong');
      name.textContent = u.display_name;
      const meta = document.createElement('span');
      meta.className = 'admin-meta';
      meta.textContent = ` ${u.username}${u.is_admin ? ` · ${t('admin.admin')}` : ''}${u.you ? ` · ${t('lb.you')}` : ''}`;
      who.append(name, meta);
      const rides = document.createElement('td');
      rides.textContent = num(u.rides);
      const last = document.createElement('td');
      last.textContent = u.last_ride ? date(u.last_ride, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
      const actions = document.createElement('td');
      actions.className = 'admin-actions';
      if (!u.you) {
        actions.append(
          button(t('admin.reset'), async () => {
            if (!confirm(t('admin.confirmReset', { name: u.display_name }))) return;
            try {
              const { password } = await adminResetPassword(u.id);
              showPassword(t('admin.resetDone', { name: u.display_name, username: u.username }), password);
            } catch (err) {
              say(ridersStatus, err.message, true);
            }
          }),
          button(t('workouts.delete'), async () => {
            try {
              const data = await adminUserData(u.id);
              const what = Object.entries(data).filter(([, n]) => n > 0).map(([k, n]) => `${num(n)} ${t(`admin.data.${k}`)}`).join(', ') || t('admin.nothing');
              if (!confirm(t('admin.confirmDelete', { name: u.display_name, what }))) return;
              await adminDeleteUser(u.id);
              say(ridersStatus, t('admin.deleted', { name: u.display_name }));
              passwordBox.hidden = true;
              refreshRiders();
            } catch (err) {
              say(ridersStatus, err.message, true);
            }
          }),
        );
      }
      tr.append(who, rides, last, actions);
      ridersEl.append(tr);
    }
  }

  document.getElementById('admin-new-rider').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('admin-new-username').value.trim();
    try {
      const { user, password } = await adminCreateUser({
        username,
        display_name: document.getElementById('admin-new-name').value.trim() || undefined,
        is_admin: document.getElementById('admin-new-admin').checked,
      });
      event.target.reset();
      showPassword(t('admin.created', { name: user.display_name, username: user.username }), password);
      refreshRiders();
    } catch (err) {
      say(ridersStatus, err.message, true);
    }
  });

  async function refreshScenery() {
    try {
      const { videos, max } = await adminGetScenery();
      scenery ??= initSceneryEditor({ max });
      scenery.load(videos);
      say(sceneryStatus, '');
    } catch (err) {
      say(sceneryStatus, err.message, true);
    }
  }

  document.getElementById('admin-scenery-save').addEventListener('click', async () => {
    const result = scenery.commit();
    if (result.error) return say(sceneryStatus, result.error, true);
    try {
      const { videos } = await adminSetScenery(result.text);
      scenery.load(videos);
      say(sceneryStatus, t('common.saved'));
      onSceneryChange?.(videos);
    } catch (err) {
      say(sceneryStatus, err.message, true);
    }
  });

  async function refreshReleases() {
    try {
      const { running, releases } = await adminReleases();
      document.getElementById('admin-running').textContent = running ? t('admin.running', { commit: running }) : t('admin.runningUnknown');
      const list = document.getElementById('admin-releases');
      list.innerHTML = '';
      for (const r of releases) {
        const li = document.createElement('li');
        const head = document.createElement('div');
        head.className = 'admin-release-head';
        const v = document.createElement('strong');
        v.textContent = r.version === 'next' ? t('admin.next') : r.version;
        head.append(v);
        if (r.date) head.append(` · ${date(`${r.date}T12:00:00Z`, { day: 'numeric', month: 'short', year: 'numeric' })}`);
        if (r.commit) {
          const c = document.createElement('code');
          c.textContent = r.commit;
          if (running && running.startsWith(r.commit)) c.classList.add('is-running');
          head.append(' ', c);
        }
        const ul = document.createElement('ul');
        for (const note of r.notes) {
          const n = document.createElement('li');
          n.textContent = note;
          ul.append(n);
        }
        li.append(head, ul);
        list.append(li);
      }
    } catch (err) {
      document.getElementById('admin-running').textContent = err.message;
    }
  }

  document.addEventListener('viewchange', (event) => {
    if (event.detail.view !== 'admin') return;
    passwordBox.hidden = true;
    say(ridersStatus, '');
    refreshRiders();
    refreshScenery();
    refreshReleases();
  });
}

