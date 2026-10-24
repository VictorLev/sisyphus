// No router library — a handful of statically-defined <section data-view>
// elements toggled via the hidden attribute, plus a persistent top nav that
// reflects and drives the current view.
const sections = new Map();
let navButtons = [];
let chromeEl = null;

// Views that are sub-pages of a nav destination, so the right tab still
// reads as active while you're on them.
// Build is part of Workouts; Chronicle (and a ride's page), Feats and Badges
// are Profile's sub-pages (ui/profile-tabs.js).
const NAV_PARENT = {
  live: 'home',
  summary: 'home',
  builder: 'workouts',
  chronicle: 'profile',
  'ride-detail': 'profile',
  feats: 'profile',
  badges: 'profile',
};

export function initViews() {
  document.querySelectorAll('[data-view]').forEach((el) => {
    sections.set(el.dataset.view, el);
    el.hidden = true;
  });

  chromeEl = document.getElementById('app-chrome');
  navButtons = [...document.querySelectorAll('[data-nav]')];
  for (const button of navButtons) {
    button.addEventListener('click', () => showView(button.dataset.nav));
  }
}

export function showView(name) {
  for (const [viewName, el] of sections) {
    el.hidden = viewName !== name;
  }

  // The ride screen is read from the bike: no chrome, and no way to navigate
  // away by accident mid-ride. End Ride is the deliberate exit.
  if (chromeEl) chromeEl.hidden = name === 'live';

  const active = NAV_PARENT[name] ?? name;
  for (const button of navButtons) {
    button.classList.toggle('is-active', button.dataset.nav === active);
  }

  document.dispatchEvent(new CustomEvent('viewchange', { detail: { view: name } }));
}
