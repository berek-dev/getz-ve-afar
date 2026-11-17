// Usage: node scripts/hash-password.ts "a long password that is hard to guess"
// Prints the two Cloudflare secrets to set: APP_PASSWORD_HASH and SESSION_SECRET.
import { hashPassword } from '../server/auth.ts';

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: node scripts/hash-password.ts "<password, at least 12 characters>"');
  process.exit(1);
}

const sessionSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

console.log(`APP_PASSWORD_HASH=${await hashPassword(password)}`);
console.log(`SESSION_SECRET=${sessionSecret}`);
