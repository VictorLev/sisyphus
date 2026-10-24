// Settings in two tabs: Ride (trainer, ride, scenery, Strava) and Account
// (password, language and theme, and for admins the log and the Admin
// Panel). Only the chosen tab's panels show; the form and Save Settings
// span both, so changes on either tab are saved together. The last tab is
// remembered in this browser.

const KEY = 'sisyphus.settingsTab';

export function initSettingsTabs() {
  const bar = document.getElementById('settings-tabs');
  const tabs = () => [...bar.querySelectorAll('[data-settings-tab]')].filter((b) => !b.hidden);

  function select(name) {
    const available = tabs().map((b) => b.dataset.settingsTab);
    const tab = available.includes(name) ? name : available[0];
    for (const b of bar.querySelectorAll('[data-settings-tab]')) {
      const on = b.dataset.settingsTab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const pane of document.querySelectorAll('[data-settings-pane]')) {
      pane.classList.toggle('is-active', pane.dataset.settingsPane === tab);
    }
    try {
      localStorage.setItem(KEY, tab);
    } catch { /* remembered for this visit only */ }
  }

  bar.addEventListener('click', (event) => {
    const b = event.target.closest('[data-settings-tab]');
    if (b) select(b.dataset.settingsTab);
  });
  // Arrow keys move between tabs, as tab bars do.
  bar.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const list = tabs();
    const i = list.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const next = list[(i + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    select(next.dataset.settingsTab);
    next.focus();
  });

  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch { /* first tab */ }
  select(saved);

  return { select };
}
