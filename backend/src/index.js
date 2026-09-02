import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, '..', '..', 'frontend');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(frontendDir));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Sisyphus server listening on http://localhost:${port}`);
});
