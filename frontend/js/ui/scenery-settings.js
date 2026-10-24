// Settings → Ride → Scenery: Random (from the shared list), Choose one (a
// drop-down of the shared videos) or My own link (a YouTube link of the
// rider's). Only the control for the chosen way shows.

import { t } from '../i18n.js';
import { parseSceneryList, parseYouTube } from './scenery.js';

export function initScenerySettings({ getShared }) {
  const modeEl = document.getElementById('setting-scenery-mode');
  const pickEl = document.getElementById('setting-scenery-pick');
  const customEl = document.getElementById('setting-scenery-custom');
  const pickField = document.getElementById('scenery-pick-field');
  const customField = document.getElementById('scenery-custom-field');

  function show() {
    pickField.hidden = modeEl.value !== 'pick';
    customField.hidden = modeEl.value !== 'custom';
  }
  modeEl.addEventListener('change', show);

  return {
    // After the settings load: the shared videos as choices, theirs chosen.
    render(data) {
      pickEl.innerHTML = '';
      for (const video of parseSceneryList(getShared())) {
        const option = document.createElement('option');
        option.value = video.id;
        option.textContent = video.name;
        pickEl.append(option);
      }
      if ([...pickEl.options].some((o) => o.value === data.scenery_pick)) pickEl.value = data.scenery_pick;
      show();
    },
    // Before saving: an own link must be a YouTube video.
    check() {
      if (modeEl.value === 'custom' && !parseYouTube(customEl.value)) {
        return t('scenery.badLink', { link: customEl.value || '—' });
      }
      return null;
    },
  };
}
