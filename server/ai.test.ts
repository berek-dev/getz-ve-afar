import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDraft, userPrompt } from './ai.ts';
import type { PriceListEntry } from './ai.ts';

const list: PriceListEntry[] = [
  { id: 2, name: 'פרופיל 60×40×2', unit: 'm', category: 'profile', unit_cost: 22, stock_length_mm: 6000 },
  { id: 4, name: 'ציר כבד', unit: 'unit', category: 'hardware', unit_cost: 45, stock_length_mm: null },
];

test('drafts are priced from the price list and validated', () => {
  const { lines, notes } = sanitizeDraft(
    {
      lines: [
        { element_id: 2, group_name: 'מסגרת', description: 'אנכיים', unit: 'm', quantity: 99, pieces: 4, length_mm: 1750 },
        { element_id: 4, group_name: 'פרזול', description: '', unit: 'unit', quantity: 4 },
        { element_id: 4, group_name: 'פרזול', description: 'ציר במטרים?', unit: 'm', quantity: 2 },
        { element_id: null, group_name: 'עבודה', description: 'ייצור', unit: 'hour', quantity: 12 },
        { element_id: null, description: 'שטויות', unit: 'parsec', quantity: 1 },
      ],
      notes: ['הנחתי גובה 1.75 מ׳', 7],
    },
    list,
    180,
  );
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0], {
    element_id: 2,
    group_name: 'מסגרת',
    description: 'אנכיים',
    quantity: 7,
    unit: 'm',
    unit_cost: 22,
    length_mm: 1750,
    pieces: 4,
  });
  assert.equal(lines[1].description, 'ציר כבד');
  assert.equal(lines[2].element_id, null); // unit mismatch drops the element
  assert.equal(lines[2].unit_cost, 0);
  assert.equal(lines[3].unit_cost, 180);
  assert.deepEqual(notes, ['הנחתי גובה 1.75 מ׳']);
});

test('garbage in, nothing out', () => {
  assert.deepEqual(sanitizeDraft('nope', list, 180), { lines: [], notes: [] });
});

test('prompt carries the price list but nothing about the client', () => {
  const p = userPrompt({ title: 'שער', kind: 'fabrication', description: null }, 'שער 4 מטר', list);
  assert.ok(p.includes('2 | פרופיל 60×40×2 | m | profile | bar 6000mm'));
  assert.ok(!p.includes('client'));
});
