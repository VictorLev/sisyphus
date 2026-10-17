import 'dotenv/config';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createApp, db } from './app.js';

const app = createApp();
// 7479 spells SISY on a phone keypad, and unlike 3000 it is unlikely to
// collide with whatever else is running.
const port = Number(process.env.PORT) || 7479;
// Default to all interfaces so a home-server install is reachable on the LAN.
const host = process.env.HOST || '0.0.0.0';

const certPath = process.env.TLS_CERT;
const keyPath = process.env.TLS_KEY;

// HTTPS matters more here than for a typical app: Web Bluetooth only works in
// a secure context. localhost is exempt, but a LAN address over plain HTTP is
// not — the browser will refuse to talk to the trainer at all. Point TLS_CERT
// and TLS_KEY at a certificate (mkcert, Tailscale, Let's Encrypt) and the
// server terminates TLS itself, no reverse proxy required.
const useTls = Boolean(certPath && keyPath);

const server = useTls
  ? https.createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, app)
  : http.createServer(app);

server.listen(port, host, () => {
  const scheme = useTls ? 'https' : 'http';
  console.log(`Sisyphus listening on ${scheme}://${host}:${port}`);

  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    console.warn(
      '\n  No accounts exist yet, so nobody can log in.\n' +
      '  Set ADMIN_USERNAME and ADMIN_PASSWORD and restart, or run\n' +
      '  `npm run add-user -- <username> --admin`. Existing rides are kept\n' +
      '  and will belong to that first admin.\n'
    );
  }

  // Behind a TLS-terminating proxy (TRUST_PROXY set, as in deploy/compose.yaml)
  // plain HTTP inside the container is expected, so the warning is skipped.
  if (!useTls && !process.env.TRUST_PROXY && host !== '127.0.0.1' && host !== 'localhost') {
    console.warn(
      '\n  Serving plain HTTP on a non-local address.\n' +
      '  Opening this from another machine will work, but the trainer will NOT\n' +
      '  connect: Web Bluetooth requires a secure context, and only localhost is\n' +
      '  exempt. Set TLS_CERT and TLS_KEY to serve HTTPS. See the README.\n'
    );
  }
});

// Node as PID 1 in a container ignores SIGTERM unless it is handled, so
// `docker compose up` after an update used to wait out the 10-second grace
// period and then kill the app mid-write. Closing the database checkpoints
// the WAL into the main file, so the volume holds one tidy file at rest.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
