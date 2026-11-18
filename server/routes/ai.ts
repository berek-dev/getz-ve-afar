/** POST /api/ai/lines – draft BOQ lines from a dictated description. Off until GEMINI_API_KEY is set. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, sanitizeDraft, userPrompt } from '../ai.ts';
import { aiErrorCode, geminiText } from '../gemini.ts';
import type { PriceListEntry } from '../ai.ts';

export function registerAi(app: App): void {
  app.post('/ai/lines', async (c) => {
    if (!c.env.GEMINI_API_KEY) return c.json({ error: 'ai_not_configured' }, 503);
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

    try {
      const reply = await geminiText(c.env, {
        system: SYSTEM_PROMPT,
        contents: [{ role: 'user', parts: [{ text: userPrompt(job, text, list) }] }],
        schema: RESPONSE_SCHEMA,
      });
      let raw: unknown;
      try {
        raw = JSON.parse(reply);
      } catch {
        return c.json({ error: 'ai_bad_output' }, 502);
      }
      return c.json(sanitizeDraft(raw, list, settings?.hourly_rate ?? 0));
    } catch (e) {
      return c.json({ error: aiErrorCode(e) }, e instanceof Error && e.message === 'ai_not_configured' ? 503 : 502);
    }
  });
}
