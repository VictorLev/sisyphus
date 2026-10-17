import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, addUser, client, login, sessionCookieFrom } from './helpers.js';

const tmp = useTempDb();

let server;
let base;
const servers = [];

before(async () => {
  ({ server, base } = await startServer());
  await addUser('alice', 'alice-password', { displayName: 'Alice A.' });
});

after(() => {
  server?.close();
  for (const s of servers) s.close();
  tmp.cleanup();
});

// A separate app instance has its own limiter, so the rate-limit tests
// cannot lock out the rest of the file (every request here shares one IP).
async function isolatedServer(options) {
  const started = await startServer(options);
  servers.push(started.server);
  return started.base;
}

describe('protected routes', () => {
  test('every data route answers 401 without a login', async () => {
    const anon = client(base);
    const calls = [
      ['GET', '/api/workouts'],
      ['POST', '/api/workouts'],
      ['GET', '/api/workouts/1'],
      ['PUT', '/api/workouts/1'],
      ['DELETE', '/api/workouts/1'],
      ['PATCH', '/api/workouts/1/starred'],
      ['POST', '/api/workouts/1/copy'],
      ['GET', '/api/sessions'],
      ['POST', '/api/sessions'],
      ['GET', '/api/sessions/1'],
      ['DELETE', '/api/sessions/1'],
      ['GET', '/api/records'],
      ['GET', '/api/level'],
      ['GET', '/api/profile'],
      ['PUT', '/api/profile'],
      ['GET', '/api/settings'],
      ['PUT', '/api/settings'],
      ['GET', '/api/auth/me'],
      ['POST', '/api/auth/password'],
      ['GET', '/api/no-such-route'],
    ];
    for (const [method, url] of calls) {
      const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: ['GET', 'DELETE'].includes(method) ? undefined : '{}',
      });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
    assert.equal((await anon.get('/api/health')).status, 200, 'health stays public');
    assert.equal((await anon.get('/')).status, 200, 'the shell (with the login screen) stays public');
  });

  test('a made-up or garbage cookie is not a login', async () => {
    for (const cookie of ['sisyphus_session=nope', 'sisyphus_session=%E0%A4%A', 'other=1']) {
      assert.equal((await client(base, cookie).get('/api/workouts')).status, 401, cookie);
    }
  });
});

describe('login and logout', () => {
  test('logs in, reports who is logged in, and logs out', async () => {
    const res = await client(base).post('/api/auth/login', { username: 'alice', password: 'alice-password' });
    assert.equal(res.status, 200);
    const user = await res.json();
    assert.deepEqual(user, { id: user.id, username: 'alice', display_name: 'Alice A.', is_admin: false });
    assert.ok(!('password_hash' in user));

    const setCookie = res.headers.getSetCookie().join('\n');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Expires=/i);

    const alice = client(base, sessionCookieFrom(res));
    assert.equal((await (await alice.get('/api/auth/me')).json()).username, 'alice');
    assert.equal((await alice.get('/api/workouts')).status, 200);

    assert.equal((await alice.post('/api/auth/logout')).status, 204);
    assert.equal((await alice.get('/api/workouts')).status, 401, 'the token is dead after logout');
  });

  test('usernames are case-insensitive', async () => {
    const res = await client(base).post('/api/auth/login', { username: 'ALICE', password: 'alice-password' });
    assert.equal(res.status, 200);
  });

  test('a wrong password and an unknown user get the same answer', async () => {
    const wrong = await client(base).post('/api/auth/login', { username: 'alice', password: 'nope-nope' });
    const unknown = await client(base).post('/api/auth/login', { username: 'mallory', password: 'nope-nope' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await wrong.json(), await unknown.json());
    assert.equal(sessionCookieFrom(wrong), null, 'no cookie on failure');
  });

  test('rejects a missing username or password', async () => {
    assert.equal((await client(base).post('/api/auth/login', { username: 'alice' })).status, 400);
    assert.equal((await client(base).post('/api/auth/login', {})).status, 400);
  });

  test('the cookie is Secure only when the request came over HTTPS', async () => {
    // Through the tunnel cloudflared says so in X-Forwarded-Proto, which is
    // honoured only when TRUST_PROXY is set (as deploy/compose.yaml does).
    const proxied = await isolatedServer({ trustProxy: 1 });
    const https = await client(proxied).post(
      '/api/auth/login',
      { username: 'alice', password: 'alice-password' },
      { 'X-Forwarded-Proto': 'https' }
    );
    assert.match(https.headers.getSetCookie().join(), /;\s*Secure/i);

    // Plain http://localhost (npm run dev) must get a cookie it can store.
    const plain = await client(base).post('/api/auth/login', { username: 'alice', password: 'alice-password' });
    assert.doesNotMatch(plain.headers.getSetCookie().join(), /;\s*Secure/i);

    // And without TRUST_PROXY a forged header is ignored.
    const forged = await client(base).post(
      '/api/auth/login',
      { username: 'alice', password: 'alice-password' },
      { 'X-Forwarded-Proto': 'https' }
    );
    assert.doesNotMatch(forged.headers.getSetCookie().join(), /;\s*Secure/i);
  });
});

describe('rate limiting', () => {
  test('locks a username after repeated failures, even with the right password', async () => {
    const b = await isolatedServer({ loginLimits: { perIp: 100, perUser: 3 } });
    for (let i = 0; i < 3; i++) {
      assert.equal((await client(b).post('/api/auth/login', { username: 'alice', password: 'wrong-guess' })).status, 401);
    }
    const locked = await client(b).post('/api/auth/login', { username: 'Alice', password: 'alice-password' });
    assert.equal(locked.status, 429, 'locked regardless of the case it is typed in');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
  });

  test('locks an IP that guesses across many usernames', async () => {
    const b = await isolatedServer({ loginLimits: { perIp: 4, perUser: 100 } });
    for (const name of ['a1', 'a2', 'a3', 'a4']) {
      assert.equal((await client(b).post('/api/auth/login', { username: name, password: 'wrong-guess' })).status, 401);
    }
    const res = await client(b).post('/api/auth/login', { username: 'alice', password: 'alice-password' });
    assert.equal(res.status, 429);
  });

  test('successful logins do not count against the limit', async () => {
    const b = await isolatedServer({ loginLimits: { perIp: 2, perUser: 2 } });
    for (let i = 0; i < 5; i++) {
      assert.equal((await client(b).post('/api/auth/login', { username: 'alice', password: 'alice-password' })).status, 200);
    }
  });

  test('the lock lifts when the window passes', async () => {
    const b = await isolatedServer({ loginLimits: { perIp: 100, perUser: 1, windowMs: 300 } });
    await client(b).post('/api/auth/login', { username: 'alice', password: 'wrong-guess' });
    assert.equal((await client(b).post('/api/auth/login', { username: 'alice', password: 'alice-password' })).status, 429);
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal((await client(b).post('/api/auth/login', { username: 'alice', password: 'alice-password' })).status, 200);
  });
});

describe('changing a password', () => {
  test('needs the current password, then works and ends other sessions', async () => {
    await addUser('carol', 'carol-password');
    const laptop = await login(base, 'carol', 'carol-password');
    const desktop = await login(base, 'carol', 'carol-password');

    const wrong = await laptop.post('/api/auth/password', { current_password: 'guess-guess', new_password: 'brand-new-pass' });
    assert.equal(wrong.status, 403);
    const short = await laptop.post('/api/auth/password', { current_password: 'carol-password', new_password: 'short' });
    assert.equal(short.status, 400);

    const ok = await laptop.post('/api/auth/password', { current_password: 'carol-password', new_password: 'brand-new-pass' });
    assert.equal(ok.status, 204);

    assert.equal((await laptop.get('/api/auth/me')).status, 200, 'the session that changed it stays in');
    assert.equal((await desktop.get('/api/auth/me')).status, 401, 'every other session is logged out');

    assert.equal((await client(base).post('/api/auth/login', { username: 'carol', password: 'carol-password' })).status, 401);
    await login(base, 'carol', 'brand-new-pass');
  });
});

describe('accounts', () => {
  test('usernames are unique regardless of case', async () => {
    await assert.rejects(addUser('ALICE', 'another-password'), /already exists/);
  });

  test('rejects weak passwords and odd usernames', async () => {
    await assert.rejects(addUser('dave', 'short'), /at least 8/);
    await assert.rejects(addUser('d a v e', 'long-enough-pw'), /username/);
  });

  test('stores a salted scrypt hash, never the password', async () => {
    const { default: db } = await import('../backend/src/db/index.js');
    const [a, b] = await Promise.all([addUser('erin', 'same-password'), addUser('frank', 'same-password')]);
    const rows = db.prepare('SELECT password_hash FROM users WHERE id IN (?, ?)').all(a.id, b.id);
    for (const { password_hash } of rows) {
      assert.match(password_hash, /^scrypt\$/);
      assert.ok(!password_hash.includes('same-password'));
    }
    assert.notEqual(rows[0].password_hash, rows[1].password_hash, 'salted: same password, different hash');
  });

  test('stores only a hash of the session token', async () => {
    const { default: db } = await import('../backend/src/db/index.js');
    const alice = await login(base, 'alice', 'alice-password');
    const token = decodeURIComponent(alice.cookie.split('=')[1]);
    const hit = db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash = ?').get(token);
    assert.equal(hit.n, 0);
  });
});
