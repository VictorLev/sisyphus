// Settings → Strava: when on, each ride's page offers its .tcx file, a link
// to Strava's upload page and its description to copy, and a ride that just
// ended asks for a description first. Nothing goes to Strava from here; the
// rider uploads the file themselves (Strava's API needs a paid
// subscription).
//
// Strava's upload page ignores a description inside the file (the TCX
// <Notes> stays for other apps), so it goes to the clipboard and the rider
// pastes it into Strava's Description box.

import { setSessionDescription } from '../api/client.js';
import { t } from '../i18n.js';

const UPLOAD_PAGE = 'https://www.strava.com/upload/select';

let enabled = false;

export function setStravaExport(on) {
  enabled = Boolean(on);
}

export const stravaExportOn = () => enabled;

const tcxUrl = (sessionId) => `/api/sessions/${sessionId}/tcx`;

// Resolves true once copied. Must start inside the click: a copy begun
// after an await counts as unasked-for and is refused.
function copy(text) {
  if (!text || !navigator.clipboard) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}

function download(sessionId) {
  const a = document.createElement('a');
  a.href = tcxUrl(sessionId);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// The Strava box on a ride's page: download, upload page, and the ride's
// description to edit and copy (saved when it changes).
export function showRideExport(el, session) {
  el.hidden = !enabled;
  if (!enabled) return;
  el.querySelector('#detail-tcx').href = tcxUrl(session.id);
  const textEl = el.querySelector('#detail-strava-description');
  const statusEl = el.querySelector('#detail-strava-status');
  textEl.value = session.description ?? '';
  statusEl.textContent = '';
  let saved = textEl.value;

  textEl.onchange = async () => {
    try {
      await setSessionDescription(session.id, textEl.value);
      saved = textEl.value;
    } catch (err) {
      statusEl.textContent = err.message;
    }
  };
  el.querySelector('#detail-strava-copy').onclick = async () => {
    const copied = copy(textEl.value.trim());
    if (textEl.value !== saved) textEl.onchange();
    statusEl.textContent = (await copied) ? t('strava.copied') : t('strava.copyFailed');
  };
}

// After a ride: write a description, then Save downloads the file, opens
// Strava's upload page and copies the description; the box then says what
// to do on Strava. "Not this time" just closes.
export function askToPostRide(sessionId) {
  if (!enabled) return;
  const dialog = document.getElementById('strava-dialog');
  const writeEl = document.getElementById('strava-step-write');
  const nextEl = document.getElementById('strava-step-next');
  const textEl = document.getElementById('strava-description');
  const previewEl = document.getElementById('strava-description-preview');
  const pasteStep = document.getElementById('strava-next-paste');
  const statusEl = document.getElementById('strava-dialog-status');
  const saveBtn = document.getElementById('strava-save-btn');
  textEl.value = '';
  statusEl.textContent = '';
  saveBtn.disabled = false;
  writeEl.hidden = false;
  nextEl.hidden = true;

  const close = () => dialog.close();
  document.getElementById('strava-skip-btn').onclick = close;
  document.getElementById('strava-done-btn').onclick = close;

  saveBtn.onclick = async () => {
    const description = textEl.value.trim();
    // Both before any await, or the browser blocks them.
    window.open(UPLOAD_PAGE, '_blank', 'noopener');
    const copied = copy(description);
    saveBtn.disabled = true;
    try {
      await setSessionDescription(sessionId, description);
    } catch (err) {
      statusEl.textContent = err.message;
    }
    download(sessionId);

    previewEl.textContent = description;
    pasteStep.hidden = !description;
    writeEl.hidden = true;
    nextEl.hidden = false;
    if (description && !(await copied)) statusEl.textContent = t('strava.copyFailed');
    document.getElementById('strava-copy-btn').onclick = async () => {
      statusEl.textContent = (await copy(description)) ? t('strava.copied') : t('strava.copyFailed');
    };
  };

  dialog.showModal();
  textEl.focus();
}
