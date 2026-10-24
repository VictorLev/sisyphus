// Admin Panel → Scenery: one row per video (a name and a YouTube link),
// with + to add (up to `max`) and × to remove. commit() turns the rows into
// the scenery text ("Name | link, ...") the server keeps.

import { t } from '../i18n.js';
import { parseYouTube, sceneryRows, serializeSceneryRows } from './scenery.js';

export function initSceneryEditor({ max = Infinity } = {}) {
  const listEl = document.getElementById('scenery-rows');
  const addBtn = document.getElementById('scenery-add-btn');
  const full = () => {
    addBtn.disabled = listEl.children.length >= max;
  };

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
      full();
      changed();
    });

    li.append(nameInput, linkInput, remove);
    listEl.appendChild(li);
    full();
    if (focus) nameInput.focus();
  }

  // Adding or removing a row is an edit, like typing: the settings page
  // lights up its Save button on 'input'.
  const changed = () => listEl.dispatchEvent(new Event('input', { bubbles: true }));

  addBtn.addEventListener('click', () => {
    if (listEl.children.length >= max) return;
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

    // The rows as scenery text: { text }, or { error } for the first link
    // that isn't a YouTube video (its row is marked).
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
        return { error: t('scenery.badLink', { link: bad.link }) };
      }
      return { text: serializeSceneryRows(rows) };
    },
  };
}
