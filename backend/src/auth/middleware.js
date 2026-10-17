import { resolveSession } from './login-sessions.js';

export const COOKIE_NAME = 'sisyphus_session';

// Minimal cookie parsing; one cookie is all this app reads, so it is not
// worth a dependency.
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// HttpOnly so page scripts can never read the token; SameSite=Lax so another
// site cannot make the browser send it with a forged POST/PUT/DELETE.
// Secure whenever the request arrived over HTTPS: through the tunnel that is
// always (cloudflared reports it in X-Forwarded-Proto, honoured because
// TRUST_PROXY is set), while plain http://localhost in development gets a
// cookie it can actually store.
export function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
}

// Attaches req.user when the request carries a live session. Never rejects:
// that is requireUser's job, so the auth routes can see who (if anyone) is
// calling without being locked behind a login themselves.
export function loadUser(req, res, next) {
  const token = readCookie(req, COOKIE_NAME);
  const session = resolveSession(token);
  if (session) {
    req.user = session.user;
    req.sessionToken = token;
    if (session.renewed) setSessionCookie(req, res, token, session.renewed);
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}
