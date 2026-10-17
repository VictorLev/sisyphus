// Gives an existing account a new temporary password and logs it out
// everywhere, for a rider who has forgotten theirs.
//
//   npm run reset-password -- <username> [--password <pw>]
//
// Without --password a random temporary one is generated and printed.
import 'dotenv/config';
import { generatePassword } from '../src/auth/password.js';
import { findUserByUsername, setPassword } from '../src/auth/users.js';
import { endAllSessions } from '../src/auth/login-sessions.js';

const username = process.argv[2];
const flag = process.argv.indexOf('--password');
const chosenPassword = flag === -1 ? null : process.argv[flag + 1];
if (!username || username.startsWith('--')) {
  console.error('usage: npm run reset-password -- <username> [--password <pw>]');
  process.exit(2);
}

const user = findUserByUsername(username);
if (!user) {
  console.error(`No user "${username}".`);
  process.exit(1);
}

const password = chosenPassword ?? generatePassword();
try {
  await setPassword(user.id, password);
} catch (err) {
  console.error(`Could not reset: ${err.message}`);
  process.exit(1);
}
endAllSessions(user.id);
console.log(`Reset "${user.username}" and logged them out everywhere.`);
console.log(chosenPassword == null ? `Temporary password: ${password}` : 'Password set as given.');
