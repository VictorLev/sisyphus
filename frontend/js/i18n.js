// Languages: English and Canadian French.
//
// The language setting is 'auto' (follow Chrome: the first of the browser's
// languages that is French or English wins, anything else means English),
// 'en' or 'fr'. It lives in the rider's settings, and a copy is kept in this
// browser so the login screen, shown before settings load, is already in
// the right language.
//
// Static text: index.html carries the English inline and marks each piece
// with data-i18n (text), data-i18n-html (text with markup, from our own
// dictionary only) or data-i18n-attr ("placeholder:key;title:key"). In
// English nothing needs doing; in French applyTranslations() swaps them.
// Dynamic text: modules call t('key', { params }).

import { EN } from './i18n/en.js';
import { FR } from './i18n/fr.js';

const DICTS = { en: EN, fr: FR };
const STORAGE_KEY = 'sisyphus.language';
export const LANGUAGE_SETTINGS = ['auto', 'en', 'fr'];

let current = 'en';

export function resolveLanguage(setting, languages = globalThis.navigator?.languages ?? []) {
  if (setting === 'en' || setting === 'fr') return setting;
  for (const tag of languages) {
    const base = String(tag).toLowerCase().slice(0, 2);
    if (base === 'fr' || base === 'en') return base;
  }
  return 'en';
}

export const language = () => current;
export const locale = () => (current === 'fr' ? 'fr-CA' : 'en-CA');

export function t(key, params = {}) {
  const text = DICTS[current][key] ?? EN[key] ?? FR[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
}

// A translation if there is one, else the given text: for names that come
// from data (a library workout, a segment label) and may have none.
export function tOr(key, fallback, params) {
  return DICTS[current][key] != null || EN[key] != null ? t(key, params) : fallback;
}

// A workout segment's label: translated when it's a known one ("Warmup"),
// or a known one with a number ("Step 5" -> "Palier 5"); as typed otherwise.
export function label(text) {
  if (!text) return text;
  if (DICTS[current][`label.${text}`] != null) return t(`label.${text}`);
  const m = String(text).match(/^(.*\S)\s+(\d+)$/);
  if (m && DICTS[current][`label.${m[1]}`] != null) return `${t(`label.${m[1]}`)} ${m[2]}`;
  return text;
}

// Plurals: `${key}.one` or `${key}.other`, with {n} available. French
// treats 0 and 1 as singular ("0 sortie"), English only 1.
export function tp(key, n, params = {}) {
  const one = current === 'fr' ? Math.abs(n) < 2 : n === 1;
  return t(`${key}.${one ? 'one' : 'other'}`, { n: num(n), ...params });
}

export function num(value, digits = 0) {
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function date(value, options) {
  return new Date(value).toLocaleDateString(locale(), options);
}

export function storedSetting() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return LANGUAGE_SETTINGS.includes(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function rememberSetting(setting) {
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch { /* storage off: the account's setting still applies after load */ }
}

export function applyTranslations(root = globalThis.document) {
  if (current === 'en' || !root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  // Only ever our own dictionary strings, never user data.
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}

// Picks the language and translates the page. Returns it.
export function initLanguage(setting = storedSetting()) {
  current = resolveLanguage(setting);
  if (globalThis.document) {
    document.documentElement.lang = locale();
    applyTranslations(document);
  }
  return current;
}

// For tests.
export function setLanguageForTests(lang) {
  current = lang === 'fr' ? 'fr' : 'en';
}
