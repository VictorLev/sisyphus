// Prints riders' browser logs (what Settings → Log showed on their machine),
// oldest first, for reading or pasting into a bug report.
//
//   npm run logs
//   npm run logs -- --user max --level warn --since 2026-11-01 --limit 500
import 'dotenv/config';
import { queryClientLogs } from '../src/client-logs.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const rows = queryClientLogs({ user: opt('user'), level: opt('level') ?? 'info', since: opt('since'), limit: opt('limit') ?? 300 });
if (rows.length === 0) console.log('No logs.');
for (const r of rows.reverse()) {
  console.log(`${r.at} ${r.username.padEnd(12)} ${r.level.toUpperCase().padEnd(5)} ${r.message}`);
}
