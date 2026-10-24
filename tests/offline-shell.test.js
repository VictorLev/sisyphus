// The offline shell (frontend/sw.js) must cache every module the app loads,
// or the app fails to start offline. New modules are easy to forget there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = new URL('../frontend/', import.meta.url).pathname;
const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');

function modules(dir) {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(path.join(root, rel)).isDirectory() ? modules(rel) : rel.endsWith('.js') ? [rel] : [];
  });
}

test('every app module is in the offline shell', () => {
  // probe.js belongs to the hardware probe page, not the app.
  const missing = modules('js').filter((f) => f !== 'js/probe.js' && !sw.includes(`'/${f}'`));
  assert.deepEqual(missing, [], 'add these to SHELL in frontend/sw.js and bump CACHE');
});
