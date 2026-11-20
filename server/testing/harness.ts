/**
 * Integration tests without Cloudflare: a D1 stand-in on Node's built-in SQLite with the real migrations applied,
 * and a small router that runs the real route handlers with the parts of Hono's context they use (params, JSON
 * body, headers, c.json, env, executionCtx). Lives outside the typecheck (it uses node:sqlite); tests only.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Row = Record<string, unknown>;
type Meta = { changes: number; last_row_id: number };

const value = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Statement {
  db: DatabaseSync;
  sql: string;
  params: unknown[];
  constructor(db: DatabaseSync, sql: string, params: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params);
  }
  /** Runs the statement: its rows (RETURNING included) and what it changed */
  exec(): { rows: Row[]; meta: Meta } {
    const rows = this.db.prepare(this.sql).all(...(this.params.map(value) as never[])) as Row[];
    const m = this.db.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get() as Meta;
    return { rows: rows.map((r) => ({ ...r })), meta: { changes: Number(m.changes), last_row_id: Number(m.last_row_id) } };
  }
  async all<T = Row>() {
    const { rows, meta } = this.exec();
    return { results: rows as T[], success: true, meta };
  }
  async first<T = Row>(column?: string): Promise<T | null> {
    const row = this.exec().rows[0];
    if (!row) return null;
    return (column ? (row[column] as T) : (row as T)) ?? null;
  }
  async run() {
    const { meta } = this.exec();
    return { results: [], success: true, meta };
  }
  async raw() {
    return this.exec().rows.map((r) => Object.values(r));
  }
}

/** A fresh database with every migration applied, as D1 runs them */
export function testDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(root, 'migrations', file), 'utf8'));
  }
  return {
    sqlite: db,
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => {
          const { rows, meta } = s.exec();
          return { results: rows, success: true, meta };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
}

export type TestDb = ReturnType<typeof testDb>;

type Handler = (c: unknown) => Response | Promise<Response>;

/**
 * The routes a module registers (`register(app)`), callable as `call('POST', '/jobs/1/model', body)`.
 * Paths are as the app sees them under /api. Background work handed to waitUntil is kept in `pending`.
 */
export function routes(register: (app: never) => void, env: Record<string, unknown>) {
  const table: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
  const add = (method: string) => (path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:([a-zA-Z_]+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
    table.push({ method, pattern, keys, handler });
  };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
  register(app as never);
  const pending: Promise<unknown>[] = [];

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const url = new URL(`https://app.test/api${path}`);
    for (const r of table) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(url.pathname.replace(/^\/api/, ''));
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const c = {
        env,
        req: {
          param: (k: string) => params[k],
          json: async () => {
            if (body === undefined) throw new SyntaxError('no body');
            return JSON.parse(JSON.stringify(body));
          },
          header: (h: string) => headers[h.toLowerCase()],
          query: (k: string) => url.searchParams.get(k) ?? undefined,
          url: url.toString(),
        },
        json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }),
        executionCtx: { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => undefined },
      };
      return r.handler(c);
    }
    return new Response(JSON.stringify({ error: 'no route' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }

  return { call, pending, paths: table.map((r) => `${r.method} ${r.pattern.source}`) };
}

/** The last event of a server-sent-events answer (what the app reads) */
export async function lastEvent(res: Response): Promise<Record<string, unknown>> {
  const events = (await res.text())
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b.startsWith('data:'))
    .map((b) => JSON.parse(b.slice(5)) as Record<string, unknown>);
  return events[events.length - 1] ?? {};
}

/** Gemini's streamed answer carrying `text` */
export function geminiAnswer(text: string): Response {
  const event = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`;
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(event));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

/** Replaces fetch for Google's API: answers in order, records what each call was sent */
export function fakeGemini(answers: string[]) {
  const calls: { url: string; body: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (!url.includes('generativelanguage.googleapis.com')) return real(input as never, init as never);
    calls.push({ url, body: String(init?.body ?? '') });
    const next = answers.shift();
    return next === undefined ? new Response('{}', { status: 400 }) : geminiAnswer(next);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}
