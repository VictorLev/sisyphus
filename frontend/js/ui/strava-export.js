// Settings → Strava: when on, each ride's page offers its .tcx file and a
// link to Strava's upload page, and a ride that just ended asks for a
// description first. Nothing goes to Strava from here; the rider uploads
// the file themselves (Strava's API needs a paid subscription).

import { setSessionDescription } from '../api/client.js';
import { t } from '../i18n.js';

const UPLOAD_PAGE = 'https://www.strava.com/upload/select';

let enabled = false;

export function setStravaExport(on) {
  enabled = Boolean(on);
}

export const stravaExportOn = () => enabled;

const tcxUrl = (sessionId) => `/api/sessions/${sessionId}/tcx`;

export function showRideExport(el, sessionId) {
  el.hidden = !enabled;
  if (!enabled) return;
  el.querySelector('#detail-tcx').href = tcxUrl(sessionId);
}

function download(sessionId) {
  const a = document.createElement('a');
  a.href = tcxUrl(sessionId);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// After a ride: a description, then Save downloads the file and opens
// Strava's upload page; "Not this time" just closes.
export function askToPostRide(sessionId) {
  if (!enabled) return;
  const dialog = document.getElementById('strava-dialog');
  const textEl = document.getElementById('strava-description');
  const statusEl = document.getElementById('strava-dialog-status');
  const saveBtn = document.getElementById('strava-save-btn');
  const skipBtn = document.getElementById('strava-skip-btn');
  textEl.value = '';
  statusEl.textContent = '';
  saveBtn.disabled = false;

  const close = () => {
    saveBtn.onclick = null;
    skipBtn.onclick = null;
    dialog.close();
  };

  saveBtn.onclick = async () => {
    const description = textEl.value.trim();
    // Both need the click itself: a tab opened or a copy made after an
    // await counts as unasked-for and gets blocked.
    window.open(UPLOAD_PAGE, '_blank', 'noopener');
    if (description) navigator.clipboard?.writeText(description).catch(() => {});
    saveBtn.disabled = true;
    try {
      await setSessionDescription(sessionId, description);
    } catch (err) {
      // The file still downloads, just without the description in it.
      statusEl.textContent = err.message;
    }
    download(sessionId);
    close();
  };
  skipBtn.onclick = close;

  dialog.showModal();
  textEl.focus();
}
