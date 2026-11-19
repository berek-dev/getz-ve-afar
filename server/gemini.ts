/** Gemini API (free tier, key from aistudio.google.com). Shared by the BOQ draft and the 3D layout. */
import type { Env } from './env.ts';

/** Free-tier text models, newest first (ai.google.dev/pricing, Nov 2026). GEMINI_MODEL overrides. */
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}
export interface GeminiTurn {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Worth another try, here or on a lighter model: Google overloaded (503) or hiccuped (500/502/504), or a
 * connection cut (524 is Cloudflare giving up after 100 seconds without an answer).
 */
const TRANSIENT = new Set([500, 502, 503, 504, 524]);

export interface GeminiDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}
const realDeps: GeminiDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

/** Stop starting new attempts after this long (the run gives up at about 4 minutes). */
const BUDGET_MS = 150_000;
/** An attempt silent for this long (thinking, or stuck in a queue) is cut and the next one tries. */
const IDLE_MS = 90_000;
/** An attempt still streaming this long after the deadline is cut. */
const OVERTIME_MS = 90_000;

/** What one attempt did, for the run's log */
export interface GeminiAttempt {
  model: string;
  status: number;
  /** ms until the first piece of the reply (null: none came) */
  firstMs: number | null;
  ms: number;
  chars: number;
}

type Thinking = 'minimal' | 'low' | 'medium' | 'high';

/**
 * Reads Gemini's server-sent events: each event carries the next piece of the reply. Returns the text,
 * or throws { status } for an error Google sends mid-stream.
 */
export async function readGeminiStream(res: Response, onPiece: (chars: number) => void = () => undefined): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const take = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const ev = JSON.parse(data) as {
      error?: { code?: number };
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    };
    if (ev.error) throw Object.assign(new Error('stream_error'), { status: ev.error.code ?? 500 });
    for (const p of ev.candidates?.[0]?.content?.parts ?? []) if (!p.thought && p.text) text += p.text;
    onPiece(text.length);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      take(buffer.slice(0, nl).replace(/\r$/, ''));
      buffer = buffer.slice(nl + 1);
    }
  }
  take(buffer.trim());
  return text;
}

/**
 * One reply from Gemini, streamed (a long silent wait would be cut after 100 seconds). On the free tier Google
 * often answers 503 ("the model is overloaded") or 429 (that model's quota): each model gets a second try after a
 * short pause, then the next, lighter model takes over. `thinking` lowers how long the model thinks first (edits
 * need little). Errors are thrown as codes the routes pass on: ai_not_configured, ai_busy (quota), ai_overloaded
 * (every model overloaded or too slow), ai_failed_<status>, ai_empty.
 */
export async function geminiText(
  env: Pick<Env, 'GEMINI_API_KEY' | 'GEMINI_MODEL'>,
  request: {
    system?: string;
    contents: GeminiTurn[];
    json?: boolean;
    schema?: unknown;
    temperature?: number;
    thinking?: Thinking;
    /** No new attempt after this time (ms since epoch) */
    deadlineAt?: number;
    onAttempt?: (a: GeminiAttempt) => void;
  },
  deps: GeminiDeps = realDeps,
): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error('ai_not_configured');
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...DEFAULT_MODELS.filter((m) => m !== env.GEMINI_MODEL)] : DEFAULT_MODELS;
  const bodyFor = (thinking: Thinking | undefined) => {
    const generationConfig: Record<string, unknown> = { temperature: request.temperature ?? 0.2 };
    if (request.json || request.schema) generationConfig.responseMimeType = 'application/json';
    if (request.schema) generationConfig.responseSchema = request.schema;
    if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
    return JSON.stringify({
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      contents: request.contents,
      generationConfig,
    });
  };
  const stopAt = Math.min(deps.now() + BUDGET_MS, request.deadlineAt ?? Infinity);
  let sawQuota = false;
  let sawTransient = false;
  let lastStatus = 0;
  for (const model of models) {
    let thinking = request.thinking;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (deps.now() > stopAt) break;
      const ctl = new AbortController();
      const t0 = deps.now();
      let firstMs: number | null = null;
      let chars = 0;
      // Cut the attempt after IDLE_MS without a piece of the reply, or well past the deadline
      let silent = false;
      const cut = () => {
        silent = true;
        ctl.abort();
      };
      let idle = setTimeout(cut, IDLE_MS);
      const hard = setTimeout(() => ctl.abort(), Math.max(IDLE_MS, stopAt + OVERTIME_MS - deps.now()));
      const alive = (n: number) => {
        if (firstMs === null) firstMs = deps.now() - t0;
        chars = n;
        clearTimeout(idle);
        idle = setTimeout(cut, IDLE_MS);
      };
      let status = 0;
      let text: string | null = null;
      try {
        const res = await deps.fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
            body: bodyFor(thinking),
            signal: ctl.signal,
          },
        );
        status = res.status;
        if (res.ok) text = await readGeminiStream(res, alive);
      } catch (e) {
        // cut mid-way, silent too long, or an error event in the stream
        status = (e as { status?: number }).status ?? 503;
      } finally {
        clearTimeout(idle);
        clearTimeout(hard);
      }
      request.onAttempt?.({ model, status: text !== null ? 200 : status, firstMs, ms: deps.now() - t0, chars });
      if (text !== null) {
        if (!text.trim()) throw new Error('ai_empty');
        return text;
      }
      lastStatus = status;
      if (status === 400 && thinking) {
        thinking = undefined; // this model doesn't take the thinking setting: same attempt without it
        attempt--;
        continue;
      }
      if (status === 404) break; // model retired: next one
      if (status === 429) {
        sawQuota = true; // free-tier quotas are per model: the next one may still have room
        break;
      }
      if (!TRANSIENT.has(status)) throw new Error(`ai_failed_${status}`);
      sawTransient = true;
      if (silent) break; // this model is too slow right now: don't wait on it twice
      if (attempt === 0) await deps.sleep(1500 + Math.floor(Math.random() * 1000));
    }
  }
  if (sawTransient) throw new Error('ai_overloaded');
  if (sawQuota) throw new Error('ai_busy');
  throw new Error(`ai_failed_${lastStatus}`);
}

/** Error → the code sent to the app */
export function aiErrorCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  return msg.startsWith('ai_') ? msg : 'ai_failed';
}
