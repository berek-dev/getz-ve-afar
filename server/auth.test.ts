import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, hashPassword, timingSafeEqual, verifyPassword, verifySession } from './auth.ts';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

test('hashPassword output verifies with the same password only', async () => {
  const stored = await hashPassword('ברזל ואדמה 2026!');
  assert.match(stored, /^pbkdf2-sha256\$20000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword('ברזל ואדמה 2026!', stored), true);
  assert.equal(await verifyPassword('ברזל ואדמה 2026', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

test('same password gets a different salt each time', async () => {
  assert.notEqual(await hashPassword('x'), await hashPassword('x'));
});

test('verifyPassword rejects malformed stored values', async () => {
  for (const bad of ['', 'plain', 'pbkdf2-sha256$abc$x$y', 'pbkdf2-sha256$999999$AAAA$AAAA', 'md5$1$AA$AA', 'pbkdf2-sha256$1000$!!$AA']) {
    assert.equal(await verifyPassword('x', bad), false, bad);
  }
});

test('session round-trip returns the expiry', async () => {
  const { token, exp } = await createSession(SECRET, NOW, 1000);
  assert.equal(await verifySession(token, SECRET, NOW + 999), exp);
});

test('expired session is rejected', async () => {
  const { token } = await createSession(SECRET, NOW, 1000);
  assert.equal(await verifySession(token, SECRET, NOW + 1000), null);
});

test('session signed with another secret is rejected', async () => {
  const { token } = await createSession('another-secret', NOW, 1000);
  assert.equal(await verifySession(token, SECRET, NOW), null);
});

test('tampered session payload is rejected', async () => {
  const { token } = await createSession(SECRET, NOW, 1000);
  const [, sig] = token.split('.');
  const forgedPayload = btoa(JSON.stringify({ v: 1, exp: NOW + 10 ** 12 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.equal(await verifySession(`${forgedPayload}.${sig}`, SECRET, NOW), null);
});

test('garbage tokens are rejected', async () => {
  for (const bad of [undefined, null, '', 'abc', 'a.b.c', '%%%.%%%']) {
    assert.equal(await verifySession(bad, SECRET, NOW), null, String(bad));
  }
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2])), false);
});
