// Creates an account and prints a temporary password to hand to the rider.
//
//   npm run add-user -- <username> [--admin] [--name "Display Name"]
//
// On the server:
//   docker compose exec app npm run add-user -- alice --name "Alice"
import 'dotenv/config';
import { generatePassword } from '../src/auth/password.js';
import { createUser } from '../src/auth/users.js';

const args = process.argv.slice(2);
let username = null;
let displayName = null;
let isAdmin = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--admin') isAdmin = true;
  else if (args[i] === '--name') displayName = args[++i];
  else if (!args[i].startsWith('--') && !username) username = args[i];
  else {
    console.error(`unexpected argument: ${args[i]}`);
    process.exit(2);
  }
}
if (!username) {
  console.error('usage: npm run add-user -- <username> [--admin] [--name "Display Name"]');
  process.exit(2);
}

const password = generatePassword();
try {
  const user = await createUser({ username, password, displayName, isAdmin });
  console.log(`Created ${user.is_admin ? 'admin ' : ''}"${user.username}" (shown as "${user.display_name}").`);
  console.log(`Temporary password: ${password}`);
  console.log('They can change it under Settings -> Account after logging in.');
} catch (err) {
  console.error(`Could not create user: ${err.message}`);
  process.exit(1);
}
