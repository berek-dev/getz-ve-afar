/** POST /api/ai/lines – draft BOQ lines from a dictated description. Off until GEMINI_API_KEY is set. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, sanitizeDraft, userPrompt } from '../ai.ts';
import type { PriceListEntry } from '../ai.ts';

/** Free-tier text models, newest first (ai.google.dev/pricing, Nov 2026). GEMINI_MODEL overrides. */
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

async function callGemini(apiKey: string, models: string[], prompt: string): Promise<unknown> {
  let lastStatus = 0;
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
      }),
    });
    if (res.status === 404) {
      lastStatus = 404; // model retired – try the next one
      continue;
    }
    if (res.status === 429) throw new Error('ai_busy');
    if (!res.ok) throw new Error(`ai_failed_${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('ai_bad_output');
    }
  }
  throw new Error(`ai_failed_${lastStatus}`);
}

export function registerAi(app: App): void {
  app.post('/ai/lines', async (c) => {
    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) return c.json({ error: 'ai_not_configured' }, 503);
    const body = await c.req.json<{ job_id?: unknown; text?: unknown }>();
    const jobId = parseId(String(body.job_id ?? ''));
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 3000) : '';
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    if (text.length < 5) return c.json({ error: 'text_too_short' }, 400);

    const db = c.env.DB;
    const job = await db.prepare('SELECT title, kind, description FROM jobs WHERE id = ?').bind(jobId).first<{
      title: string;
      kind: string;
      description: string | null;
    }>();
    if (!job) return c.json({ error: 'not found' }, 404);
    const [{ results: list }, settings] = await Promise.all([
      db
        .prepare('SELECT id, name, unit, category, unit_cost, stock_length_mm FROM elements WHERE active = 1 ORDER BY category, family, name LIMIT 800')
        .all<PriceListEntry>(),
      db.prepare('SELECT hourly_rate FROM settings WHERE id = 1').first<{ hourly_rate: number }>(),
    ]);

    const models = c.env.GEMINI_MODEL ? [c.env.GEMINI_MODEL, ...DEFAULT_MODELS] : DEFAULT_MODELS;
    try {
      const raw = await callGemini(apiKey, models, userPrompt(job, text, list));
      return c.json(sanitizeDraft(raw, list, settings?.hourly_rate ?? 0));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'ai_failed';
      return c.json({ error: msg.startsWith('ai_') ? msg : 'ai_failed' }, 502);
    }
  });
}
