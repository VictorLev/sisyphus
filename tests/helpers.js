// Shared plumbing for the backend tests. Not a test file itself (npm test
// only runs *.test.js).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Points the backend at a throwaway database. Must run before the backend is
// imported, since the db module opens the file at module load. Each test
// file runs in its own process, so each gets its own database.
export function useTempDb(name = 'test.db') {
  const dir = mkdtempSync(path.join(tmpdir(), 'sisyphus-test-'));
  process.env.DB_PATH = path.join(dir, name);
  process.env.NODE_ENV = 'test';
  return { dir, dbPath: process.env.DB_PATH, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Listens on an OS-picked port, so tests never collide with a dev server.
export async function startServer(options) {
  const { createApp } = await import('../backend/src/app.js');
  const server = createApp(options).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

export async function addUser(username, password, extra = {}) {
  const { createUser } = await import('../backend/src/auth/users.js');
  return createUser({ username, password, ...extra });
}

// A tiny cookie-carrying client: Node's fetch has no cookie jar.
export function client(base, cookie = null) {
  const send = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res;
  };
  return {
    get cookie() { return cookie; },
    get: (url, headers) => send('GET', url, undefined, headers),
    post: (url, body, headers) => send('POST', url, body ?? {}, headers),
    put: (url, body) => send('PUT', url, body),
    patch: (url, body) => send('PATCH', url, body),
    del: (url) => send('DELETE', url),
  };
}

export function sessionCookieFrom(res) {
  const header = res.headers.getSetCookie().find((c) => c.startsWith('sisyphus_session='));
  return header ? header.split(';')[0] : null;
}

export async function login(base, username, password) {
  const res = await client(base).post('/api/auth/login', { username, password });
  if (res.status !== 200) throw new Error(`login as ${username} failed: ${res.status}`);
  return client(base, sessionCookieFrom(res));
}
