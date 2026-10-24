// Profile's sub-pages: Profile, Chronicle, Feats and Badges share one tab
// bar, under the main menu's Profile. The bar is a single element moved to
// the top of whichever of them is showing (a ride's page counts as
// Chronicle).

import { showView } from './views.js';

const PAGES = ['profile', 'chronicle', 'feats', 'badges'];
const SUB_OF = { 'ride-detail': 'chronicle' };

export function initProfileTabs() {
  const bar = document.getElementById('profile-subnav');
  bar.addEventListener('click', (event) => {
    const b = event.target.closest('[data-subnav]');
    if (b) showView(b.dataset.subnav);
  });
  document.addEventListener('viewchange', (event) => {
    const page = SUB_OF[event.detail.view] ?? event.detail.view;
    if (!PAGES.includes(page)) return;
    const section = document.querySelector(`[data-view="${event.detail.view}"]`);
    section.prepend(bar);
    for (const b of bar.querySelectorAll('[data-subnav]')) {
      const on = b.dataset.subnav === page;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  });
}
