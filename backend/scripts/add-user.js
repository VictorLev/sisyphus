// Creates an account and prints a temporary password to hand to the rider.
//
//   npm run add-user -- <username> [--admin] [--name "Display Name"] [--password <pw>]
//
// Without --password a random temporary one is generated and printed, which
// is what to hand a rider. --password is for local development, where any
// non-empty password is accepted (production requires 8+ characters).
//
// On the server:
//   docker exec sisyphus npm run add-user -- alice --name "Alice"
import 'dotenv/config';
import { generatePassword } from '../src/auth/password.js';
import { createUser } from '../src/auth/users.js';

const args = process.argv.slice(2);
let username = null;
let displayName = null;
let isAdmin = false;
let chosenPassword = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--admin') isAdmin = true;
  else if (args[i] === '--name') displayName = args[++i];
  else if (args[i] === '--password') chosenPassword = args[++i];
  else if (!args[i].startsWith('--') && !username) username = args[i];
  else {
    console.error(`unexpected argument: ${args[i]}`);
    process.exit(2);
  }
}
if (!username) {
  console.error('usage: npm run add-user -- <username> [--admin] [--name "Display Name"] [--password <pw>]');
  process.exit(2);
}

const password = chosenPassword ?? generatePassword();
try {
  const user = await createUser({ username, password, displayName, isAdmin });
  console.log(`Created ${user.is_admin ? 'admin ' : ''}"${user.username}" (shown as "${user.display_name}").`);
  if (chosenPassword == null) {
    console.log(`Temporary password: ${password}`);
    console.log('They can change it under Settings -> Account after logging in.');
  } else {
    console.log('Password set as given.');
  }
} catch (err) {
  console.error(`Could not create user: ${err.message}`);
  process.exit(1);
}
