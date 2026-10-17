// The in-app log (Settings → Log): capped, survives a reload, and records
// console output without changing what the console does.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { logEvent, getLog, clearLog, formatLog, onLog, installLogCapture, MAX_ENTRIES } = await import('../frontend/js/log.js');

beforeEach(() => store.clear());

test('records entries with level, time and a readable message', () => {
  logEvent('error', 'ERG failed:', new Error('GATT operation failed'));
  const [entry] = getLog();
  assert.equal(entry.level, 'error');
  assert.equal(entry.message, 'ERG failed: GATT operation failed');
  assert.ok(!Number.isNaN(Date.parse(entry.at)));
});

test(`keeps only the newest ${MAX_ENTRIES}`, () => {
  for (let i = 0; i < MAX_ENTRIES + 25; i++) logEvent('info', `event ${i}`);
  const entries = getLog();
  assert.equal(entries.length, MAX_ENTRIES);
  assert.equal(entries[0].message, 'event 25');
  assert.equal(entries.at(-1).message, `event ${MAX_ENTRIES + 24}`);
});

test('survives a reload (it lives in localStorage) and clears', () => {
  logEvent('warn', 'Trainer disconnected.');
  assert.match(store.get('sisyphus.log'), /Trainer disconnected/);
  clearLog();
  assert.deepEqual(getLog(), []);
});

test('formats as plain text, oldest first, for copying', () => {
  logEvent('info', 'first');
  logEvent('error', 'second');
  const lines = formatLog().split('\n');
  assert.match(lines[0], /INFO  first$/);
  assert.match(lines[1], /ERROR second$/);
});

test('corrupt storage reads as an empty log instead of breaking the app', () => {
  store.set('sisyphus.log', '{not json');
  assert.deepEqual(getLog(), []);
  logEvent('info', 'still works');
  assert.equal(getLog().length, 1);
});

test('mirrors console output into the log, and the console still prints', () => {
  const printed = [];
  const fakeConsole = { info: (...a) => printed.push(a), warn: (...a) => printed.push(a), error: (...a) => printed.push(a) };
  const seen = [];
  const stop = onLog((entry) => seen.push(entry));
  installLogCapture({ console: fakeConsole });
  fakeConsole.warn('[app] resistance write failed:', 'timeout');
  stop();
  assert.deepEqual(printed, [['[app] resistance write failed:', 'timeout']]);
  assert.equal(getLog().at(-1).message, '[app] resistance write failed: timeout');
  assert.equal(seen.length, 1);
});
