// Gives an existing account a new temporary password and logs it out
// everywhere, for a rider who has forgotten theirs.
//
//   npm run reset-password -- <username>
import 'dotenv/config';
import { generatePassword } from '../src/auth/password.js';
import { findUserByUsername, setPassword } from '../src/auth/users.js';
import { endAllSessions } from '../src/auth/login-sessions.js';

const username = process.argv[2];
if (!username) {
  console.error('usage: npm run reset-password -- <username>');
  process.exit(2);
}

const user = findUserByUsername(username);
if (!user) {
  console.error(`No user "${username}".`);
  process.exit(1);
}

const password = generatePassword();
await setPassword(user.id, password);
endAllSessions(user.id);
console.log(`Reset "${user.username}" and logged them out everywhere.`);
console.log(`Temporary password: ${password}`);
