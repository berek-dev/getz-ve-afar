import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiText } from './gemini.ts';
import type { GeminiDeps } from './gemini.ts';

const env = { GEMINI_API_KEY: 'k', GEMINI_MODEL: undefined };
const ask = { contents: [{ role: 'user' as const, parts: [{ text: 'hi' }] }] };
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

/** Fake Google: answers in order, records which model each call went to */
function fake(answers: (number | string)[]) {
  const calls: string[] = [];
  let clock = 0;
  const deps: GeminiDeps = {
    fetch: async (url) => {
      calls.push(String(url).split('/models/')[1].split(':')[0]);
      const a = answers.shift() ?? 503;
      return typeof a === 'string' ? ok(a) : new Response('{}', { status: a });
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls };
}

test('a 503 is retried on the same model, then answered', async () => {
  const { deps, calls } = fake([503, 'layout']);
  assert.equal(await geminiText(env, ask, deps), 'layout');
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});

test('a model that stays overloaded hands over to the next one', async () => {
  const { deps, calls } = fake([503, 503, 'layout']);
  assert.equal(await geminiText(env, ask, deps), 'layout');
  assert.notEqual(calls[2], calls[0]);
});

test('every model overloaded → ai_overloaded, quota on every model → ai_busy', async () => {
  await assert.rejects(geminiText(env, ask, fake([]).deps), /ai_overloaded/);
  await assert.rejects(geminiText(env, ask, fake([429, 429, 429]).deps), /ai_busy/);
});

test('a bad request is not retried', async () => {
  const { deps, calls } = fake([400]);
  await assert.rejects(geminiText(env, ask, deps), /ai_failed_400/);
  assert.equal(calls.length, 1);
});
