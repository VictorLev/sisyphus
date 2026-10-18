// Settings → Scenery: one row per video (a name and a YouTube link), with
// + to add and × to remove. The rows are saved as the scenery_videos text
// ("Name | link, ..."), through the hidden #setting-scenery-videos input
// that the settings form reads.

import { t } from '../i18n.js';
import { parseYouTube, sceneryRows, serializeSceneryRows } from './scenery.js';

export function initSceneryEditor() {
  const listEl = document.getElementById('scenery-rows');
  const hiddenEl = document.getElementById('setting-scenery-videos');
  const addBtn = document.getElementById('scenery-add-btn');

  function addRow({ name = '', link = '' } = {}, focus = false) {
    const li = document.createElement('li');
    li.className = 'scenery-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'scenery-name';
    nameInput.value = name;
    nameInput.placeholder = t('scenery.namePlaceholder');
    nameInput.setAttribute('aria-label', t('scenery.name'));

    const linkInput = document.createElement('input');
    linkInput.type = 'url';
    linkInput.className = 'scenery-link';
    linkInput.value = link;
    linkInput.spellcheck = false;
    linkInput.placeholder = t('scenery.linkPlaceholder');
    linkInput.setAttribute('aria-label', t('scenery.link'));
    linkInput.addEventListener('input', () => li.classList.remove('is-invalid'));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary scenery-remove';
    remove.textContent = '×';
    remove.title = t('scenery.remove');
    remove.setAttribute('aria-label', t('scenery.remove'));
    remove.addEventListener('click', () => {
      li.remove();
      // Always leave one row to type into.
      if (!listEl.children.length) addRow();
      changed();
    });

    li.append(nameInput, linkInput, remove);
    listEl.appendChild(li);
    if (focus) nameInput.focus();
  }

  // Adding or removing a row is an edit, like typing: the settings page
  // lights up its Save button on 'input'.
  const changed = () => listEl.dispatchEvent(new Event('input', { bubbles: true }));

  addBtn.addEventListener('click', () => {
    addRow({}, true);
    changed();
  });

  return {
    // From the saved text.
    load(text) {
      listEl.innerHTML = '';
      const rows = sceneryRows(text);
      (rows.length ? rows : [{}]).forEach((row) => addRow(row));
    },

    // Into the hidden input before saving. Returns an error message for the
    // first link that isn't a YouTube video (and marks its row), else null.
    commit() {
      const rows = [...listEl.children].map((li) => ({
        li,
        name: li.querySelector('.scenery-name').value,
        link: li.querySelector('.scenery-link').value.trim(),
      }));
      const bad = rows.find((row) => row.link && !parseYouTube(row.link));
      if (bad) {
        bad.li.classList.add('is-invalid');
        bad.li.querySelector('.scenery-link').focus();
        return t('scenery.badLink', { link: bad.link });
      }
      hiddenEl.value = serializeSceneryRows(rows);
      return null;
    },
  };
}
