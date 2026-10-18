// Dark (the original look, and the default) or light (lighter beige).
//
// The theme is a rider setting, applied by setting data-theme on <html>;
// style.css swaps its colour tokens from there. A copy is kept in this
// browser so an inline script in index.html can apply it before the first
// paint, without a flash of the wrong theme.

const STORAGE_KEY = 'sisyphus.theme';
export const THEMES = ['dark', 'light'];

// The browser's toolbar colour on phones, matched to the page.
const THEME_COLOR = { dark: '#1c1915', light: '#e6dcc9' };

export function applyTheme(theme) {
  const value = THEMES.includes(theme) ? theme : 'dark';
  const root = document.documentElement;
  if (value === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[value]);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch { /* storage off: the account's setting still applies after load */ }
  // Canvases read their colours from the tokens when they draw.
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: value } }));
  return value;
}
