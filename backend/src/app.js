import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db/index.js';
import workoutsRouter from './routes/workouts.js';
import sessionsRouter from './routes/sessions.js';
import configRouter from './routes/config.js';
import recordsRouter from './routes/records.js';
import levelRouter from './routes/level.js';
import ftpRouter from './routes/ftp.js';
import { createAuthRouter } from './routes/auth.js';
import { loadUser, requireUser } from './auth/middleware.js';
import { LoginLimiter } from './auth/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, '..', '..', 'frontend');

// TRUST_PROXY says how many proxy hops sit in front of the app, so that
// req.ip and req.secure come from X-Forwarded-For / -Proto. Behind the
// Cloudflare tunnel that is 1 (cloudflared). Left unset, the headers are
// ignored, which is right for `npm run dev` where anyone could send them.
function trustProxyFromEnv(value) {
  if (value === undefined || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // an address or subnet list, as Express accepts
}

// The configured app, exported without listening so tests can mount it on an
// ephemeral port. index.js is the only place that binds.
//
// Options exist for tests: a fresh limiter per app so rate-limit tests do not
// lock each other out, and trust-proxy without touching the environment.
export function createApp({ loginLimits, trustProxy = trustProxyFromEnv(process.env.TRUST_PROXY) } = {}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  // The service worker must never be served from cache, or a stale copy can
  // pin the app to an old shell. Must come before express.static.
  app.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('application/javascript');
    res.sendFile(path.join(frontendDir, 'sw.js'));
  });

  app.use(express.static(frontendDir));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  // Everything below needs a logged-in rider. The static shell above stays
  // public: the code is open source anyway, and the login screen is part of
  // it. Health is public so Docker's healthcheck can call it.
  app.use('/api', loadUser);
  app.use('/api/auth', express.json({ limit: '10kb' }), createAuthRouter(new LoginLimiter(loginLimits)));
  // Express defaults to a 100kb JSON body. A sample serialises to ~86 bytes,
  // so at one per second that budget runs out after ~1190 samples — just
  // under 20 minutes. Every longer ride was silently rejected with a 413.
  // 25mb covers ~85 hours at 1 Hz, far past any real session. Parsed only
  // after the login check, so an anonymous caller cannot make the server
  // read 25mb bodies.
  app.use('/api', requireUser, express.json({ limit: '25mb' }));

  app.use('/api/workouts', workoutsRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/records', recordsRouter);
  app.use('/api/level', levelRouter);
  app.use('/api/ftp', ftpRouter);
  app.use('/api', configRouter);

  return app;
}

export { db };
