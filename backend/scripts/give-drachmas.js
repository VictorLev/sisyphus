// Gives a rider drachmas for the shop, on top of what their riding and
// badges have earned.
//
//   npm run give-drachmas -- <username> <amount> [--note "why"]
import 'dotenv/config';
import { findUserByUsername } from '../src/auth/users.js';
import { giveDrachmas } from '../src/routes/shop.js';
import { GIFT_MAX } from '../src/shop-catalog.js';

const [username, amountText] = process.argv.slice(2);
const flag = process.argv.indexOf('--note');
const note = flag === -1 ? null : process.argv[flag + 1] ?? null;
const amount = Number(amountText);
if (!username || !Number.isInteger(amount) || amount < 1 || amount > GIFT_MAX) {
  console.error(`usage: npm run give-drachmas -- <username> <amount 1-${GIFT_MAX}> [--note "why"]`);
  process.exit(2);
}
const user = findUserByUsername(username);
if (!user) {
  console.error(`No user "${username}".`);
  process.exit(1);
}
const { balance } = giveDrachmas(user.id, amount, { note });
console.log(`Gave ${amount} drachmas to "${user.username}". Their balance is now ${balance}.`);
