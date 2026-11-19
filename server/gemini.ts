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

/** Google says "overloaded" or had a hiccup: worth another try, here or on a lighter model. */
const TRANSIENT = new Set([500, 502, 503, 504]);

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

/** Stop starting new attempts after this long (the user is waiting, and a run gets a few minutes at most). */
const BUDGET_MS = 100_000;

/**
 * One generateContent call; returns the reply text. On the free tier Google often answers 503 ("the model is
 * overloaded") or 429 (that model's quota): each model gets a second try after a short pause, then the next,
 * lighter model takes over. Errors are thrown as codes the routes pass on: ai_not_configured, ai_busy (quota),
 * ai_overloaded (every model overloaded), ai_failed_<status>, ai_empty.
 */
export async function geminiText(
  env: Pick<Env, 'GEMINI_API_KEY' | 'GEMINI_MODEL'>,
  request: { system?: string; contents: GeminiTurn[]; json?: boolean; schema?: unknown; temperature?: number },
  deps: GeminiDeps = realDeps,
): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error('ai_not_configured');
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...DEFAULT_MODELS.filter((m) => m !== env.GEMINI_MODEL)] : DEFAULT_MODELS;
  const generationConfig: Record<string, unknown> = { temperature: request.temperature ?? 0.2 };
  if (request.json || request.schema) generationConfig.responseMimeType = 'application/json';
  if (request.schema) generationConfig.responseSchema = request.schema;
  const body = JSON.stringify({
    ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
    contents: request.contents,
    generationConfig,
  });
  const started = deps.now();
  let sawQuota = false;
  let sawTransient = false;
  let lastStatus = 0;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (deps.now() - started > BUDGET_MS) break;
      let res: Response;
      try {
        res = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body,
        });
      } catch {
        res = new Response(null, { status: 503 }); // network trouble on the way to Google: same as overloaded
      }
      if (res.ok) {
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
        const text = (data.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => !p.thought)
          .map((p) => p.text ?? '')
          .join('');
        if (!text.trim()) throw new Error('ai_empty');
        return text;
      }
      lastStatus = res.status;
      if (res.status === 404) break; // model retired: next one
      if (res.status === 429) {
        sawQuota = true; // free-tier quotas are per model: the next one may still have room
        break;
      }
      if (!TRANSIENT.has(res.status)) throw new Error(`ai_failed_${res.status}`);
      sawTransient = true;
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
