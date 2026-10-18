import { getLog, clearLog, onLog, formatLog } from '../log.js';
import { t, locale } from '../i18n.js';

// The entries themselves stay in English: they are for bug reports.

// Settings → Log: the in-app event log, newest first, with Copy and Clear.
export function initLogPanel() {
  const listEl = document.getElementById('log-list');
  const statusEl = document.getElementById('log-status');
  const settingsView = document.querySelector('[data-view="settings"]');

  function render() {
    const entries = getLog();
    listEl.innerHTML = '';
    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'log-empty';
      li.textContent = t('log.empty');
      listEl.append(li);
      return;
    }
    for (const entry of [...entries].reverse()) {
      const li = document.createElement('li');
      li.className = `log-entry log-${entry.level}`;
      const time = document.createElement('time');
      time.dateTime = entry.at;
      time.textContent = new Date(entry.at).toLocaleString(locale(), {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      const level = document.createElement('span');
      level.className = 'log-level';
      level.textContent = entry.level;
      const message = document.createElement('span');
      message.className = 'log-message';
      message.textContent = entry.message;
      li.append(time, level, message);
      listEl.append(li);
    }
  }

  document.getElementById('log-copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(formatLog() || '(log is empty)');
      statusEl.textContent = t('log.copied');
    } catch (err) {
      statusEl.textContent = t('log.copyFailed', { error: err.message });
    }
  });
  document.getElementById('log-clear-btn').addEventListener('click', () => {
    clearLog();
    statusEl.textContent = t('log.cleared');
  });

  // Live while Settings is open; otherwise rendered when it opens.
  onLog(() => {
    if (!settingsView.hidden) render();
  });
  document.addEventListener('viewchange', (event) => {
    if (event.detail.view === 'settings') {
      statusEl.textContent = '';
      render();
    }
  });
}
