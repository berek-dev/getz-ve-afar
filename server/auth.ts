/**
 * Built-in login for 1–2 users, no third-party service and no credit card:
 *  - The password is stored only as a salted PBKDF2 hash, in a Cloudflare secret (APP_PASSWORD_HASH).
 *  - A successful login sets an HttpOnly cookie holding an HMAC-signed expiry (SESSION_SECRET).
 *    Rotating SESSION_SECRET logs everyone out.
 *  - Online guessing is throttled per IP in server/app.ts.
 *
 * Iterations are kept moderate because the Workers free plan allows ~10 ms CPU per request
 * (20k iterations ≈ 3 ms). The hash itself never leaves Cloudflare's encrypted secret store.
 *
 * Web Crypto only, so it runs in Workers and in Node (tests, scripts/hash-password.ts).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const DEFAULT_PBKDF2_ITERATIONS = 20_000;
const MAX_PBKDF2_ITERATIONS = 100_000; // Workers rejects higher counts
const HASH_SCHEME = 'pbkdf2-sha256';

export const SESSION_COOKIE = 'gva_session';
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const SESSION_RENEW_BELOW_MS = 30 * 24 * 60 * 60 * 1000; // renew when < 30 days left

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(input: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new Error('invalid base64url');
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Returns "pbkdf2-sha256$<iterations>$<salt>$<hash>" – the value to store in APP_PASSWORD_HASH. */
export async function hashPassword(password: string, iterations = DEFAULT_PBKDF2_ITERATIONS): Promise<string> {
  if (iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) throw new RangeError('bad iteration count');
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const hash = await pbkdf2(password, salt, iterations);
  return `${HASH_SCHEME}$${iterations}$${toB64url(salt)}$${toB64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split('$');
  if (parts.length !== 4 || parts[0] !== HASH_SCHEME) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) return false;
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array;
  try {
    salt = fromB64url(parts[2] ?? '');
    expected = fromB64url(parts[3] ?? '');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== 32) return false;
  return timingSafeEqual(await pbkdf2(password, salt, iterations), expected);
}

interface SessionPayload {
  v: 1;
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function createSession(secret: string, now: number, ttlMs = SESSION_TTL_MS): Promise<{ token: string; exp: number }> {
  const exp = now + ttlMs;
  const payload = toB64url(enc.encode(JSON.stringify({ v: 1, exp } satisfies SessionPayload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
  return { token: `${payload}.${toB64url(sig)}`, exp };
}

/** Returns the session expiry (ms) if the token is authentic and not expired, otherwise null. */
export async function verifySession(token: string | undefined | null, secret: string, now: number): Promise<number | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts as [string, string];
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = fromB64url(sig);
  } catch {
    return null;
  }
  const authentic = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(payload));
  if (!authentic) return null;
  let data: SessionPayload;
  try {
    data = JSON.parse(dec.decode(fromB64url(payload))) as SessionPayload;
  } catch {
    return null;
  }
  if (data.v !== 1 || typeof data.exp !== 'number' || data.exp <= now) return null;
  return data.exp;
}
