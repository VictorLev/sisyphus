// Deletes an account and everything that belongs to it: rides and their
// samples, workouts, stars, profile and settings, FTP history, logins.
//
//   npm run delete-user -- <username>          # shows what would be deleted
//   npm run delete-user -- <username> --yes    # deletes it
//
// On the server:
//   docker exec sisyphus npm run delete-user -- alexis --yes
//
// There is no undo other than restoring a backup; take one first with
// `npm run backup -- --tag manual` if in doubt.
import 'dotenv/config';
import { findUserByUsername, countUserData, deleteUser } from '../src/auth/users.js';

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'));
const confirmed = args.includes('--yes');
if (!username) {
  console.error('usage: npm run delete-user -- <username> [--yes]');
  process.exit(2);
}

const user = findUserByUsername(username);
if (!user) {
  console.error(`No user "${username}".`);
  process.exit(1);
}

const summary = (counts) => Object.entries(counts).map(([label, n]) => `${n} ${label}`).join(', ');

if (!confirmed) {
  console.log(`Would delete "${user.username}" (${user.display_name}${user.is_admin ? ', admin' : ''}) and: ${summary(countUserData(user.id))}.`);
  console.log(`Nothing has been deleted. To delete, run again with --yes:`);
  console.log(`  npm run delete-user -- ${user.username} --yes`);
  process.exit(0);
}

try {
  const removed = deleteUser(user.id);
  console.log(`Deleted "${user.username}" (${user.display_name}) and: ${summary(removed)}.`);
} catch (err) {
  console.error(`Could not delete: ${err.message}`);
  process.exit(1);
}
