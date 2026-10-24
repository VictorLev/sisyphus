// Imports the routes waiting in the inbox (ROUTES_DIR/inbox): one folder per
// route, holding video.mp4, route.json and maybe picture.jpg. The same as
// the Admin Panel's "Scan for new routes".
//
//   npm run import-routes            import what's ready
//   npm run import-routes -- --list  only show what's there
import 'dotenv/config';
import { inboxDir, listInbox, scanInbox } from '../src/route-inbox.js';

const REASONS = {
  'no-video': 'no video.mp4',
  'no-route': 'no route.json',
  copying: 'still being copied (written to in the last minute)',
  exists: 'a route of that name is already in the library',
  'bad-route': 'route.json can\'t be read',
  failed: 'import failed',
};
const gb = (bytes) => (bytes == null ? '' : ` (${(bytes / 1e9).toFixed(1)} GB)`);

console.log(`Inbox: ${inboxDir()}`);
if (process.argv.includes('--list')) {
  const folders = listInbox();
  if (folders.length === 0) console.log('Empty.');
  for (const f of folders) console.log(`  ${f.reason ? '-' : '+'} ${f.folder}${gb(f.size)}${f.reason ? `: ${REASONS[f.reason]}` : ': ready'}`);
} else {
  const { imported, skipped } = await scanInbox();
  for (const r of imported) console.log(`  imported #${r.id} ${r.name}${r.left ? ' (the folder could not be removed from the inbox)' : ''}`);
  for (const s of skipped) console.log(`  skipped ${s.folder}: ${REASONS[s.reason]}${s.error ? ` (${s.error})` : ''}`);
  console.log(`${imported.length} imported, ${skipped.length} skipped.`);
}
