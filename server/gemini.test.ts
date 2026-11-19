import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiText, readGeminiStream } from './gemini.ts';
import type { GeminiDeps } from './gemini.ts';

const env = { GEMINI_API_KEY: 'k', GEMINI_MODEL: undefined };
const ask = { contents: [{ role: 'user' as const, parts: [{ text: 'hi' }] }] };
const event = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`;
const sse = (...chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

/** Fake Google: answers in order, records which model each call went to and what it was sent */
function fake(answers: (number | string | (() => Response))[]) {
  const calls: { model: string; body: string }[] = [];
  let clock = 0;
  const deps: GeminiDeps = {
    fetch: async (url, init) => {
      calls.push({ model: String(url).split('/models/')[1].split(':')[0], body: String(init?.body) });
      const a = answers.shift() ?? 503;
      if (typeof a === 'function') return a();
      return typeof a === 'string' ? sse(event(a)) : new Response('{}', { status: a });
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls };
}

test('the streamed reply is put back together, split anywhere', async () => {
  const whole = event('{"a":') + event('1}');
  const text = await readGeminiStream(sse(whole.slice(0, 7), whole.slice(7, 50), whole.slice(50)));
  assert.equal(text, '{"a":1}');
});

test('a 503 is retried on the same model, then answered', async () => {
  const { deps, calls } = fake([503, 'layout']);
  assert.equal(await geminiText(env, ask, deps), 'layout');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, calls[1].model);
});

test('a model that stays overloaded or is cut off hands over to the next one', async () => {
  const { deps, calls } = fake([503, 524, 'layout']);
  assert.equal(await geminiText(env, ask, deps), 'layout');
  assert.notEqual(calls[2].model, calls[0].model);
});

test('a stream cut in the middle counts as a failed attempt', async () => {
  const broken = () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(event('{"a"')));
          c.error(new Error('Network connection lost'));
        },
      }),
      { status: 200 },
    );
  const { deps, calls } = fake([broken, 'ok']);
  assert.equal(await geminiText(env, ask, deps), 'ok');
  assert.equal(calls.length, 2);
});

test('the thinking level is sent, and dropped if the model refuses it', async () => {
  const { deps, calls } = fake([400, 'ok']);
  assert.equal(await geminiText(env, { ...ask, thinking: 'low' }, deps), 'ok');
  assert.match(calls[0].body, /"thinkingLevel":"low"/);
  assert.doesNotMatch(calls[1].body, /thinkingLevel/);
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

test('each attempt is reported, with when the reply started', async () => {
  const seen: { model: string; status: number; chars: number }[] = [];
  const { deps } = fake([503, 'abc']);
  await geminiText(env, { ...ask, onAttempt: (a) => seen.push(a) }, deps);
  assert.deepEqual(
    seen.map((a) => [a.status, a.chars]),
    [
      [503, 0],
      [200, 3],
    ],
  );
});

test('a model stuck in the queue is overtaken by the next one', async () => {
  const { geminiHedged } = await import('./gemini.ts');
  const calls: string[] = [];
  let stuckAborted = false;
  const deps: GeminiDeps = {
    fetch: async (url, init) => {
      const model = String(url).split('/models/')[1].split(':')[0];
      calls.push(model);
      if (calls.length === 1) {
        // the first model never writes anything until it is stopped
        return new Response(
          new ReadableStream({
            start(c) {
              init?.signal?.addEventListener('abort', () => {
                stuckAborted = true;
                c.error(new Error('aborted'));
              });
            },
          }),
          { status: 200 },
        );
      }
      return sse(event('fast'));
    },
    sleep: async () => undefined,
    now: () => 0,
  };
  assert.equal(await geminiHedged(env, ask, deps), 'fast');
  assert.notEqual(calls[1], calls[0]);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(stuckAborted, 'the slow request is stopped');
});

test('a quick first model is not doubled', async () => {
  const { geminiHedged } = await import('./gemini.ts');
  let calls = 0;
  const deps: GeminiDeps = {
    fetch: async () => {
      calls++;
      return sse(event('quick'));
    },
    sleep: () => new Promise(() => undefined), // the hedge timer never fires
    now: () => 0,
  };
  assert.equal(await geminiHedged(env, ask, deps), 'quick');
  assert.equal(calls, 1);
});
