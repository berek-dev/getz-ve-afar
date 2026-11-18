import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayoutPrompt, designRequests, parseLayoutReply } from './layoutPrompt.ts';

test('the prompt carries the BOQ, the current layout and earlier changes, never more than asked', () => {
  const p = buildLayoutPrompt({
    job: { title: 'שער חניה', kind: 'fabrication', description: null },
    boq: [
      { description: 'עמוד', element_name: 'פרופיל 80/80/3', quantity: 4.6, unit: 'm', pieces: 2, length_mm: 2300 },
      { description: 'ציר כבד', quantity: 4, unit: 'unit' },
    ],
    current: { version: 1, title: 'x', members: [] },
    requests: ['להגביה'],
    request: 'מילוי כל 10 ס״מ',
  });
  assert.match(p, /- עמוד \[פרופיל 80\/80\/3\]: 2 pieces of 2300 mm/);
  assert.match(p, /- ציר כבד: 4 unit/);
  assert.match(p, /CURRENT LAYOUT:\n\{"version":1,"title":"x","members":\[\]\}/);
  assert.match(p, /Changes already applied, oldest first:\n- להגביה/);
  assert.match(p, /REQUEST \(Hebrew\):\nמילוי כל 10 ס״מ/);
  assert.doesNotMatch(p, /Notes:|An image is attached/);
});

test('a new design has a description instead of a current layout', () => {
  const p = buildLayoutPrompt({ request: 'שער הזזה', hasImage: true });
  assert.match(p, /DESCRIPTION \(Hebrew\):\nשער הזזה/);
  assert.match(p, /An image is attached/);
  assert.doesNotMatch(p, /CURRENT LAYOUT|BILL OF QUANTITIES/);
});

test('the layout is found inside code fences and chatter', () => {
  assert.deepEqual(parseLayoutReply('Here it is:\n```json\n{"a":{"b":1}}\n```\nDone.'), { a: { b: 1 } });
  assert.throws(() => parseLayoutReply('sorry, no'));
});

test('design history stops at the version that started the design', () => {
  assert.deepEqual(
    designRequests([
      { request: 'ג', mode: 'edit' },
      { request: null, mode: 'edit' },
      { request: 'ב', mode: 'edit' },
      { request: 'א', mode: 'new' },
      { request: 'ישן', mode: 'edit' },
    ]),
    ['א', 'ב', 'ג'],
  );
});
