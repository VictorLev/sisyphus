// Settings → Strava: when on, each ride's page offers its .tcx file, a link
// to Strava's upload page and the ride's title and description to copy,
// and a ride that just ended asks for them first. Nothing goes to Strava
// from here; the rider uploads the file themselves (Strava's API needs a
// paid subscription).
//
// Strava's upload page takes neither a title nor a description from the
// file, and the page can't be filled in from another site, so each one is
// copied and the rider pastes it into Strava's form. (The TCX keeps the
// description in <Notes> for apps that read it.)

import { setSessionText } from '../api/client.js';
import { t } from '../i18n.js';
import { rideName } from '../workout/names.js';

const UPLOAD_PAGE = 'https://www.strava.com/upload/select';

let enabled = false;

export function setStravaExport(on) {
  enabled = Boolean(on);
}

export const stravaExportOn = () => enabled;

const tcxUrl = (sessionId) => `/api/sessions/${sessionId}/tcx`;

// The title to offer when the rider hasn't set one: the workout, or "Free
// ride", and where it was ridden.
export function suggestedTitle(session) {
  return `${rideName(session.workout_name) || t('home.freeRide')} · Sisyphus`;
}

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

const copiedMessage = (ok, what) => (ok ? t(what === 'title' ? 'strava.copiedTitle' : 'strava.copied') : t('strava.copyFailed'));

// The Strava box on a ride's page: download, upload page, and the ride's
// title and description to edit and copy (each saved when it changes).
export function showRideExport(el, session) {
  el.hidden = !enabled;
  if (!enabled) return;
  el.querySelector('#detail-tcx').href = tcxUrl(session.id);
  const statusEl = el.querySelector('#detail-strava-status');
  statusEl.textContent = '';
  const fields = {
    title: [el.querySelector('#detail-strava-title'), el.querySelector('#detail-strava-copy-title')],
    description: [el.querySelector('#detail-strava-description'), el.querySelector('#detail-strava-copy')],
  };
  fields.title[0].value = session.title ?? suggestedTitle(session);
  fields.description[0].value = session.description ?? '';

  for (const [name, [input, button]] of Object.entries(fields)) {
    let saved = input.value;
    const save = async () => {
      if (input.value === saved) return;
      try {
        await setSessionText(session.id, { [name]: input.value });
        saved = input.value;
      } catch (err) {
        statusEl.textContent = err.message;
      }
    };
    input.onchange = save;
    button.onclick = async () => {
      const copied = copy(input.value.trim());
      save();
      statusEl.textContent = copiedMessage(await copied, name);
    };
  }
}

// After a ride: a title (suggested) and a description, then Save downloads
// the file, opens Strava's upload page and copies the title; the box then
// walks through Strava's form with a copy button for each. "Not this time"
// just closes.
export function askToPostRide(session) {
  if (!enabled) return;
  const $ = (id) => document.getElementById(id);
  const dialog = $('strava-dialog');
  const titleEl = $('strava-title');
  const textEl = $('strava-description');
  const statusEl = $('strava-dialog-status');
  const saveBtn = $('strava-save-btn');
  titleEl.value = session.title ?? suggestedTitle(session);
  textEl.value = session.description ?? '';
  statusEl.textContent = '';
  saveBtn.disabled = false;
  $('strava-step-write').hidden = false;
  $('strava-step-next').hidden = true;

  const close = () => dialog.close();
  $('strava-skip-btn').onclick = close;
  $('strava-done-btn').onclick = close;

  saveBtn.onclick = async () => {
    const title = titleEl.value.trim();
    const description = textEl.value.trim();
    // Before any await, or the browser blocks them. The title goes first:
    // it's first on Strava's form.
    window.open(UPLOAD_PAGE, '_blank', 'noopener');
    const copied = copy(title || description);
    saveBtn.disabled = true;
    try {
      await setSessionText(session.id, { title, description });
    } catch (err) {
      statusEl.textContent = err.message;
    }
    download(session.id);

    $('strava-title-preview').textContent = title;
    $('strava-description-preview').textContent = description;
    $('strava-next-title').hidden = !title;
    $('strava-next-paste').hidden = !description;
    $('strava-step-write').hidden = true;
    $('strava-step-next').hidden = false;
    if ((title || description) && !(await copied)) statusEl.textContent = t('strava.copyFailed');
    $('strava-copy-title-btn').onclick = async () => {
      statusEl.textContent = copiedMessage(await copy(title), 'title');
    };
    $('strava-copy-btn').onclick = async () => {
      statusEl.textContent = copiedMessage(await copy(description), 'description');
    };
  };

  dialog.showModal();
  textEl.focus();
}
