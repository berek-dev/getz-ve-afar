export interface Env {
  DB: D1Database;
  /** Secret. Output of `node scripts/hash-password.ts` ("pbkdf2-sha256$..."). */
  APP_PASSWORD_HASH?: string;
  /** Secret. Random string used to sign session cookies. Rotating it logs everyone out. */
  SESSION_SECRET?: string;
  /** Workers KV for photos and receipts. Added by the deploy workflow; photos are hidden without it. */
  PHOTOS?: KVNamespace;
  /** Secret, optional. Free key from aistudio.google.com turns on "draft lines from dictation". */
  GEMINI_API_KEY?: string;
  /** Optional override of the Gemini model id. */
  GEMINI_MODEL?: string;
  /** "true" only in local dev (.dev.vars). Never set in production. */
  DEV_BYPASS_AUTH?: string;
}
