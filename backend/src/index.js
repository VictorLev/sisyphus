import 'dotenv/config';
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

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// The service worker must never be served from cache, or a stale copy can
// pin the app to an old shell. Modern browsers revalidate it anyway; this
// makes it explicit. Must come before express.static.
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

app.listen(port, () => {
  console.log(`Sisyphus server listening on http://localhost:${port}`);
});
