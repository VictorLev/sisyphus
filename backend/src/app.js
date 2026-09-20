import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db/index.js';
import workoutsRouter from './routes/workouts.js';
import sessionsRouter from './routes/sessions.js';
import configRouter from './routes/config.js';
import recordsRouter from './routes/records.js';
import levelRouter from './routes/level.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, '..', '..', 'frontend');

// The configured app, exported without listening so tests can mount it on an
// ephemeral port. index.js is the only place that binds.
export function createApp() {
  const app = express();
  // Express defaults to a 100kb JSON body. A sample serialises to ~86 bytes,
  // so at one per second that budget runs out after ~1190 samples — just
  // under 20 minutes. Every longer ride was silently rejected with a 413.
  // 25mb covers ~85 hours at 1 Hz, far past any real session.
  app.use(express.json({ limit: '25mb' }));

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

  app.use('/api/workouts', workoutsRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/records', recordsRouter);
  app.use('/api/level', levelRouter);
  app.use('/api', configRouter);

  return app;
}

export { db };
