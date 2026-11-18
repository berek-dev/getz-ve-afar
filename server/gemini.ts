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
 * One generateContent call; returns the reply text. Errors are thrown as codes the routes pass on:
 * ai_not_configured, ai_busy (rate limit), ai_failed_<status>, ai_empty.
 */
export async function geminiText(
  env: Env,
  request: { system?: string; contents: GeminiTurn[]; json?: boolean; schema?: unknown; temperature?: number },
): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error('ai_not_configured');
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...DEFAULT_MODELS] : DEFAULT_MODELS;
  const generationConfig: Record<string, unknown> = { temperature: request.temperature ?? 0.2 };
  if (request.json || request.schema) generationConfig.responseMimeType = 'application/json';
  if (request.schema) generationConfig.responseSchema = request.schema;
  let lastStatus = 0;
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: request.contents,
        generationConfig,
      }),
    });
    if (res.status === 404) {
      lastStatus = 404; // model retired – try the next one
      continue;
    }
    if (res.status === 429) throw new Error('ai_busy');
    if (!res.ok) throw new Error(`ai_failed_${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    if (!text.trim()) throw new Error('ai_empty');
    return text;
  }
  throw new Error(`ai_failed_${lastStatus}`);
}

/** Error → the code sent to the app */
export function aiErrorCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  return msg.startsWith('ai_') ? msg : 'ai_failed';
}
