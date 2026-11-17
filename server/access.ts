/**
 * Verifies a Cloudflare Access JWT (header `Cf-Access-Jwt-Assertion` or cookie `CF_Authorization`).
 * Access already blocks unauthenticated visitors at the edge; this check makes sure the API
 * can't be reached around it (e.g. through a preview URL that isn't protected).
 *
 * No dependencies: uses Web Crypto, available in Workers and Node 22.
 */

export interface AccessConfig {
  /** e.g. "my-team.cloudflareaccess.com" */
  teamDomain: string;
  /** Application Audience (AUD) tag */
  aud: string;
}

export type AccessResult = { ok: true; email: string } | { ok: false; reason: string };

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

interface JwtHeader {
  alg: string;
  kid: string;
}

interface JwtPayload {
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  email?: string;
}

const KEY_CACHE_MS = 60 * 60 * 1000;
let keyCache: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null;

export function resetAccessKeyCache(): void {
  keyCache = null;
}

function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
}

async function fetchKeys(teamDomain: string, fetchFn: typeof fetch, now: number, force: boolean): Promise<Jwk[]> {
  if (!force && keyCache && keyCache.teamDomain === teamDomain && now - keyCache.fetchedAt < KEY_CACHE_MS) {
    return keyCache.keys;
  }
  const res = await fetchFn(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  keyCache = { teamDomain, keys, fetchedAt: now };
  return keys;
}

export async function verifyAccessJwt(
  token: string | null | undefined,
  cfg: AccessConfig,
  opts: { fetchFn?: typeof fetch; now?: number } = {},
): Promise<AccessResult> {
  if (!token) return { ok: false, reason: 'missing token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  const [headerPart, payloadPart, sigPart] = parts as [string, string, string];

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = decodePart<JwtHeader>(headerPart);
    payload = decodePart<JwtPayload>(payloadPart);
  } catch {
    return { ok: false, reason: 'malformed token' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'unsupported alg' };

  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now();

  let keys = await fetchKeys(cfg.teamDomain, fetchFn, now, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Keys rotate; refetch once before giving up.
    keys = await fetchKeys(cfg.teamDomain, fetchFn, now, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return { ok: false, reason: 'unknown key' };

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signedData = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const validSig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sigPart), signedData);
  if (!validSig) return { ok: false, reason: 'bad signature' };

  const nowSec = Math.floor(now / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(cfg.aud)) return { ok: false, reason: 'bad audience' };
  if (payload.iss !== `https://${cfg.teamDomain}`) return { ok: false, reason: 'bad issuer' };
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return { ok: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) return { ok: false, reason: 'not yet valid' };

  return { ok: true, email: payload.email ?? '' };
}
