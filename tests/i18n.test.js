// Translations: nothing on screen may be left without French, and the two
// languages must agree on placeholders and markup.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { EN } from '../frontend/js/i18n/en.js';
import { FR } from '../frontend/js/i18n/fr.js';
import { resolveLanguage, setLanguageForTests, t, tp, num, label } from '../frontend/js/i18n.js';
import { BADGES } from '../backend/src/badges.js';
import { ZONES } from '../frontend/js/zones.js';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), 'utf8');
// Pages with static text: the app, the hardware probe and the phone remote.
const html = read('frontend/index.html') + read('frontend/probe.html') + read('frontend/remote.html');
const library = JSON.parse(read('backend/src/db/library.json'));

function htmlKeys() {
  const keys = new Map(); // key -> inline English
  for (const m of html.matchAll(/<(\w+)\b[^>]*?data-i18n(?:-html)?="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (!keys.has(m[2])) keys.set(m[2], m[3].replace(/\s+/g, ' ').trim());
  }
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) keys.set(pair.split(':')[1].trim(), keys.get(pair.split(':')[1].trim()) ?? '');
  }
  return keys;
}

function sourceFiles(dir) {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return name === 'i18n' ? [] : sourceFiles(rel);
    return rel.endsWith('.js') ? [rel] : [];
  });
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s) => [...String(s).matchAll(/<(\w+)/g)].map((m) => m[1]).sort();

describe('choosing the language', () => {
  test('an explicit choice wins', () => {
    assert.equal(resolveLanguage('fr', ['en-US']), 'fr');
    assert.equal(resolveLanguage('en', ['fr-CA']), 'en');
  });

  test('Default follows the first French or English language Chrome prefers', () => {
    assert.equal(resolveLanguage('auto', ['fr-CA', 'en-US']), 'fr');
    assert.equal(resolveLanguage('auto', ['en-CA', 'fr-CA']), 'en');
    assert.equal(resolveLanguage('auto', ['de-DE', 'fr-FR']), 'fr', 'skips a language we do not have');
    assert.equal(resolveLanguage('auto', ['es-ES', 'de-DE']), 'en', 'neither French nor English: English');
    assert.equal(resolveLanguage('auto', []), 'en');
    assert.equal(resolveLanguage(undefined, ['fr']), 'fr');
  });
});

describe('completeness', () => {
  test('every piece of text on the page has a French translation', () => {
    const missing = [...htmlKeys().keys()].filter((k) => FR[k] == null);
    assert.deepEqual(missing, []);
  });

  test('every string the JavaScript uses exists in English and in French', () => {
    const missing = [];
    for (const file of [...sourceFiles('frontend/js'), 'frontend/js/i18n.js']) {
      // Comments mention t('key') as an example; only real calls count.
      const src = read(file).replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/\b(t|tOr)\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        for (const [lang, dict] of [['en', EN], ['fr', FR]]) {
          if (dict[m[2]] == null && !htmlKeys().has(m[2])) missing.push(`${lang} ${m[2]} (${file})`);
        }
      }
      for (const m of src.matchAll(/\btp\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        for (const form of ['one', 'other']) {
          for (const [lang, dict] of [['en', EN], ['fr', FR]]) {
            if (dict[`${m[1]}.${form}`] == null) missing.push(`${lang} ${m[1]}.${form} (${file})`);
          }
        }
      }
      for (const m of src.matchAll(/\bt\(\s*\w+\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
        for (const key of [m[1], m[2]]) {
          if (EN[key] == null && !htmlKeys().has(key)) missing.push(`en ${key} (${file})`);
          if (FR[key] == null) missing.push(`fr ${key} (${file})`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  test('every English string has a French one, and French has no strays', () => {
    assert.deepEqual(Object.keys(EN).filter((k) => FR[k] == null), []);
    const known = new Set([...Object.keys(EN), ...htmlKeys().keys()]);
    assert.deepEqual(Object.keys(FR).filter((k) => !known.has(k)), []);
  });

  test('both languages use the same {placeholders} and markup', () => {
    const mismatched = [];
    for (const [key, en] of Object.entries(EN)) {
      if (JSON.stringify(placeholders(en)) !== JSON.stringify(placeholders(FR[key]))) mismatched.push(key);
    }
    for (const [key, en] of htmlKeys()) {
      if (JSON.stringify(tags(en)) !== JSON.stringify(tags(FR[key]))) mismatched.push(key);
    }
    assert.deepEqual(mismatched, []);
  });
});

describe('text that comes from data', () => {
  test('badge texts in English match the server, and every badge has French', () => {
    for (const b of BADGES) {
      assert.equal(EN[`badge.${b.id}.name`], b.name, b.id);
      assert.equal(EN[`badge.${b.id}.desc`], b.description, b.id);
      assert.equal(EN[`badge.${b.id}.hint`], b.hint, b.id);
      assert.ok(FR[`badge.${b.id}.name`] && FR[`badge.${b.id}.desc`], b.id);
      if (b.hint) assert.ok(FR[`badge.${b.id}.hint`], `${b.id} hint`);
    }
    for (const group of new Set(BADGES.map((b) => b.group))) assert.ok(FR[`badgeGroup.${group}`] && EN[`badgeGroup.${group}`], group);
    for (const unit of new Set(BADGES.map((b) => b.unit).filter(Boolean))) assert.ok(FR[`badgeUnit.${unit}`] && EN[`badgeUnit.${unit}`], unit);
  });

  test('every library workout is named in both languages, and its labels and parts translate', () => {
    setLanguageForTests('fr');
    try {
      for (const w of library) {
        assert.equal(EN[`library.${w.key}`], w.name, w.key);
        assert.ok(FR[`library.${w.key}`], w.key);
        for (const seg of w.structure) {
          // Translated by the label itself or by its word before a number
          // ("Step 5"); some are the same word in French ("Endurance").
          const base = seg.label.replace(/\s+\d+$/, '');
          assert.ok(FR[`label.${seg.label}`] != null || FR[`label.${base}`] != null, `"${seg.label}" in ${w.key} has no French`);
          if (seg.phase) assert.ok(FR[`phase.${seg.phase}`] && FR[`phaseNote.${seg.phase}`], seg.phase);
        }
      }
    } finally {
      setLanguageForTests('en');
    }
  });

  test('zones, records and login errors', () => {
    for (const z of ZONES) assert.ok(EN[`zone.${z.id}`] && FR[`zone.${z.id}`], `zone ${z.id}`);
    const records = read('backend/src/routes/records.js');
    const keys = [...records.matchAll(/entry\('(\w+)'/g)].map((m) => m[1]);
    for (const w of records.match(/POWER_WINDOWS = \[([^\]]+)\]/)[1].split(',')) keys.push(`best_${w.trim()}s`);
    for (const k of keys) assert.ok(EN[`feat.${k}`] && FR[`feat.${k}`], `feat ${k}`);
    const codes = [...read('backend/src/routes/auth.js').matchAll(/code: '(\w+)'/g)].map((m) => m[1]);
    assert.ok(codes.length >= 5);
    for (const c of codes) assert.ok(EN[`error.${c}`] && FR[`error.${c}`], `error ${c}`);
  });
});

describe('French rules', () => {
  test('plurals: 0 and 1 are singular in French, only 1 in English', () => {
    setLanguageForTests('fr');
    try {
      assert.equal(tp('unit.rides', 0), '0 sortie');
      assert.equal(tp('unit.rides', 1), '1 sortie');
      assert.equal(tp('unit.rides', 2), '2 sorties');
      assert.equal(t('unit.pctFtp', { n: 90 }), '90 % FTP');
    } finally {
      setLanguageForTests('en');
    }
    assert.equal(tp('unit.rides', 0), '0 rides');
    assert.equal(tp('unit.rides', 1), '1 ride');
    assert.equal(t('unit.pctFtp', { n: 90 }), '90% FTP');
  });

  test('numbers use a decimal comma in French', () => {
    setLanguageForTests('fr');
    try {
      assert.equal(num(42.195, 1), '42,2');
      assert.match(num(1000), /^1\s000$/);
    } finally {
      setLanguageForTests('en');
    }
    assert.equal(num(42.195, 1), '42.2');
  });

  test('segment labels with a number keep it', () => {
    setLanguageForTests('fr');
    try {
      assert.equal(label('Step 12'), 'Palier 12');
      assert.equal(label('Warmup'), 'Échauffement');
      assert.equal(label('My own label'), 'My own label');
    } finally {
      setLanguageForTests('en');
    }
  });
});
