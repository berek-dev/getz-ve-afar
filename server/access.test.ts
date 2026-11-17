import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetAccessKeyCache, verifyAccessJwt } from './access.ts';

const TEAM = 'getz.cloudflareaccess.com';
const AUD = 'test-aud-123';
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeKeyPair() {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

async function sign(privateKey: CryptoKey, payload: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

function certsFetch(jwk: JsonWebKey, kid = 'k1'): typeof fetch {
  return (async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 })) as typeof fetch;
}

const validClaims = {
  aud: [AUD],
  iss: `https://${TEAM}`,
  email: 'yael@example.com',
  exp: Math.floor(NOW / 1000) + 3600,
  nbf: Math.floor(NOW / 1000) - 10,
};

beforeEach(() => resetAccessKeyCache());

test('accepts a valid token and returns the email', async () => {
  const kp = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const token = await sign(kp.privateKey, validClaims);
  const r = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchFn: certsFetch(jwk), now: NOW });
  assert.deepEqual(r, { ok: true, email: 'yael@example.com' });
});

test('rejects a missing token', async () => {
  const r = await verifyAccessJwt(undefined, { teamDomain: TEAM, aud: AUD });
  assert.deepEqual(r, { ok: false, reason: 'missing token' });
});

test('rejects a wrong audience', async () => {
  const kp = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const token = await sign(kp.privateKey, { ...validClaims, aud: ['other-app'] });
  const r = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchFn: certsFetch(jwk), now: NOW });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'bad audience');
});

test('rejects an expired token', async () => {
  const kp = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const token = await sign(kp.privateKey, { ...validClaims, exp: Math.floor(NOW / 1000) - 1 });
  const r = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchFn: certsFetch(jwk), now: NOW });
  assert.equal(!r.ok && r.reason, 'expired');
});

test('rejects a token signed by a different key', async () => {
  const real = await makeKeyPair();
  const attacker = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', real.publicKey);
  const token = await sign(attacker.privateKey, validClaims);
  const r = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchFn: certsFetch(jwk), now: NOW });
  assert.equal(!r.ok && r.reason, 'bad signature');
});

test('rejects a tampered payload', async () => {
  const kp = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const token = await sign(kp.privateKey, validClaims);
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64url(JSON.stringify({ ...validClaims, email: 'attacker@example.com' }))}.${s}`;
  const r = await verifyAccessJwt(forged, { teamDomain: TEAM, aud: AUD }, { fetchFn: certsFetch(jwk), now: NOW });
  assert.equal(!r.ok && r.reason, 'bad signature');
});

test('rejects a wrong issuer', async () => {
  const kp = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const token = await sign(kp.privateKey, { ...validClaims, iss: 'https://evil.cloudflareaccess.com' });
  const r = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD }, { fetchFn: certsFetch(jwk), now: NOW });
  assert.equal(!r.ok && r.reason, 'bad issuer');
});

test('rejects garbage', async () => {
  const r = await verifyAccessJwt('not-a-jwt', { teamDomain: TEAM, aud: AUD });
  assert.equal(!r.ok && r.reason, 'malformed token');
});
