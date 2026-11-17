export interface Env {
  DB: D1Database;
  /** Secret. Output of `node scripts/hash-password.ts` ("pbkdf2-sha256$..."). */
  APP_PASSWORD_HASH?: string;
  /** Secret. Random string used to sign session cookies. Rotating it logs everyone out. */
  SESSION_SECRET?: string;
  /** "true" only in local dev (.dev.vars). Never set in production. */
  DEV_BYPASS_AUTH?: string;
}
