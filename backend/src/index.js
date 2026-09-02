import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db/index.js';
import workoutsRouter from './routes/workouts.js';
import sessionsRouter from './routes/sessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, '..', '..', 'frontend');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(frontendDir));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/workouts', workoutsRouter);
app.use('/api/sessions', sessionsRouter);

app.listen(port, () => {
  console.log(`Sisyphus server listening on http://localhost:${port}`);
});
