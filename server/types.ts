import type { Hono } from 'hono';
import type { BlankSchema } from 'hono/types';
import type { Env } from './env.ts';

export type AppEnv = { Bindings: Env };
export type App = Hono<AppEnv, BlankSchema, '/api'>;

export function parseId(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
