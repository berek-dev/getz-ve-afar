import test from 'node:test';
import assert from 'node:assert/strict';
import { validateItem } from './items.ts';

test('pieces × length derive the quantity for metre lines', () => {
  const r = validateItem({ description: 'מילוי 40×20', unit: 'm', unit_cost: 10, pieces: 30, length_mm: 1670, quantity: 999 });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.item.quantity, 50.1);
  assert.equal(r.ok && r.item.pieces, 30);
});

test('plain quantity lines keep their quantity and drop cut fields', () => {
  const r = validateItem({ description: 'ציר', unit: 'unit', unit_cost: '45', quantity: '4', pieces: 3, length_mm: 100 });
  assert.deepEqual(r, {
    ok: true,
    item: { element_id: null, group_name: null, description: 'ציר', quantity: 4, unit: 'unit', unit_cost: 45, length_mm: null, pieces: null },
  });
});

test('rejects bad input', () => {
  assert.equal(validateItem({ description: '', unit: 'm', quantity: 1 }).ok, false);
  assert.equal(validateItem({ description: 'x', unit: 'furlong', quantity: 1 }).ok, false);
  assert.equal(validateItem({ description: 'x', unit: 'unit', quantity: -1 }).ok, false);
  assert.equal(validateItem({ description: 'x', unit: 'unit', quantity: 1, unit_cost: 'abc' }).ok, false);
  assert.equal(validateItem({ description: 'x', unit: 'm', pieces: 0, length_mm: 100 }).ok, false);
  assert.equal(validateItem({ description: 'x', unit: 'm', pieces: 2, length_mm: 99999 }).ok, false);
  assert.equal(validateItem({ description: 'x', unit: 'unit', quantity: 1, element_id: 'abc' }).ok, false);
});

test('trims group and treats empty as none', () => {
  const r = validateItem({ description: 'x', unit: 'hour', quantity: 2, group_name: '  עבודה  ' });
  assert.equal(r.ok && r.item.group_name, 'עבודה');
  const r2 = validateItem({ description: 'x', unit: 'hour', quantity: 2, group_name: '   ' });
  assert.equal(r2.ok && r2.item.group_name, null);
});
