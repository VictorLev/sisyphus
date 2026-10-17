import { Router } from 'express';
import { verifyPassword, burnPasswordCheck } from '../auth/password.js';
import { findUserByUsername, findUserById, publicUser, setPassword, validatePassword } from '../auth/users.js';
import { startSession, endSession, endOtherSessions } from '../auth/login-sessions.js';
import { setSessionCookie, clearSessionCookie, requireUser } from '../auth/middleware.js';

// One wording for unknown user and wrong password, so the reply does not
// confirm which usernames exist.
const BAD_LOGIN = 'Wrong username or password';

// Express 4 does not catch a rejected promise from an async handler; without
// this a thrown error would hang the request instead of returning a 500.
const wrap = (handler) => (req, res, next) => handler(req, res, next).catch(next);

export function createAuthRouter(limiter) {
  const router = Router();

  router.post('/login', wrap(async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    if (username.length > 64 || password.length > 200) return res.status(401).json({ error: BAD_LOGIN });

    const wait = limiter.retryAfter(req.ip, username);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} min.` });
    }

    const user = findUserByUsername(username);
    const ok = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordCheck(password), false);
    if (!ok) {
      limiter.recordFailure(req.ip, username);
      return res.status(401).json({ error: BAD_LOGIN });
    }

    limiter.recordSuccess(username);
    const { token, expiresAt } = startSession(user.id);
    setSessionCookie(req, res, token, expiresAt);
    res.json(publicUser(user));
  }));

  router.post('/logout', (req, res) => {
    endSession(req.sessionToken);
    clearSessionCookie(req, res);
    res.status(204).end();
  });

  router.get('/me', requireUser, (req, res) => {
    res.json(publicUser(req.user));
  });

  // Changing a password needs the current one, so a session left open on a
  // shared machine cannot be used to take the account over. Every other
  // session for the account is ended; this one stays logged in.
  router.post('/password', requireUser, wrap(async (req, res) => {
    const { current_password, new_password } = req.body ?? {};
    if (typeof current_password !== 'string' || !current_password) {
      return res.status(400).json({ error: 'current_password is required' });
    }
    const invalid = validatePassword(new_password);
    if (invalid) return res.status(400).json({ error: invalid.replace(/^password/, 'new password') });

    // The same budget as logins: this is a password check too.
    const wait = limiter.retryAfter(req.ip, req.user.username);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }
    const user = findUserById(req.user.id);
    if (!(await verifyPassword(current_password, user.password_hash))) {
      limiter.recordFailure(req.ip, req.user.username);
      return res.status(403).json({ error: 'Current password is wrong' });
    }

    await setPassword(user.id, new_password);
    endOtherSessions(user.id, req.sessionToken);
    res.status(204).end();
  }));

  return router;
}
