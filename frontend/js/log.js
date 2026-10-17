// An in-app event log, shown under Settings → Log. All Bluetooth happens in
// the browser, so when the trainer misbehaves the evidence is here, not on
// the server; this keeps it where a rider can see it and copy it into a
// message without opening DevTools.
//
// Records: console.info/warn/error (so every existing `[app] …` line lands
// here without being rewritten), uncaught errors and rejections, failed API
// calls, and Bluetooth connect/disconnect. Kept in localStorage, newest
// last, capped, so it survives the reload that follows a crash or a login.

const KEY = 'sisyphus.log';
export const MAX_ENTRIES = 200;
const listeners = new Set();

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // unreadable or unavailable storage must never break the app
  }
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Quota or private mode: the log is a convenience, not worth an error.
  }
}

function describe(value) {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// level: 'info' | 'warn' | 'error'
export function logEvent(level, ...parts) {
  const entry = {
    at: new Date().toISOString(),
    level,
    message: parts.map(describe).join(' ').slice(0, 1000),
  };
  const entries = read();
  entries.push(entry);
  write(entries);
  for (const listener of listeners) listener(entry);
  return entry;
}

export function getLog() {
  return read();
}

export function clearLog() {
  write([]);
  for (const listener of listeners) listener(null);
}

export function onLog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Plain text, oldest first, for copying into a bug report.
export function formatLog(entries = read()) {
  return entries.map((e) => `${e.at} ${e.level.toUpperCase().padEnd(5)} ${e.message}`).join('\n');
}

let installed = false;

// Mirrors console.info/warn/error into the log and catches what nothing else
// handled. The console keeps working exactly as before.
export function installLogCapture(target = globalThis) {
  if (installed) return;
  installed = true;
  for (const level of ['info', 'warn', 'error']) {
    const original = target.console[level].bind(target.console);
    target.console[level] = (...args) => {
      original(...args);
      logEvent(level, ...args);
    };
  }
  target.addEventListener?.('error', (event) => {
    // The browser's message already reads "Uncaught Error: …".
    logEvent('error', event.message, event.filename ? `(${event.filename}:${event.lineno})` : '');
  });
  target.addEventListener?.('unhandledrejection', (event) => {
    logEvent('error', 'Unhandled rejection:', event.reason);
  });
}
