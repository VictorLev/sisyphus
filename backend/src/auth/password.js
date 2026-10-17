import { scrypt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Node's built-in scrypt, so there is no native dependency to build. N=2^15
// costs ~32 MB and a few tens of milliseconds per hash: slow enough to make
// guessing expensive, fast enough that a login does not feel it. The
// parameters are stored with each hash, so they can be raised later without
// invalidating existing passwords.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
// Node refuses N*r*128 above its default 32 MB maxmem, which N=2^15 just hits.
const maxmem = (n, r) => 256 * n * r;

// Production (the Docker image sets NODE_ENV=production) requires 8
// characters. Anywhere else, i.e. `npm run dev` and the tests, any non-empty
// password is accepted so local accounts are quick to type. Read at call
// time, so the rule follows the environment the process runs in.
export function minPasswordLength() {
  return process.env.NODE_ENV === 'production' ? 8 : 1;
}

export function passwordLengthError(label = 'password') {
  const min = minPasswordLength();
  return min > 1 ? `${label} must be at least ${min} characters` : `${label} must not be empty`;
}

function encode(n, r, p, salt, hash) {
  return `scrypt$${n}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return encode(N, R, P, salt, hash);
}

// For the startup migration, which runs before the server is listening.
export function hashPasswordSync(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return encode(N, R, P, salt, hash);
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const actual = await scryptAsync(password, salt, expected.length, { N: n, r, p, maxmem: maxmem(n, r) });
  return timingSafeEqual(actual, expected);
}

// A hash of nothing in particular. Verifying against it when the username
// does not exist makes that reply take as long as a wrong password, so the
// response time does not reveal which usernames are real.
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, dummyHash);
}

// Temporary passwords handed out by the admin CLI: 16 characters from the
// URL-safe alphabet, ~96 bits. Easy to paste into a message, impossible to
// guess.
export function generatePassword() {
  return randomBytes(12).toString('base64url');
}
