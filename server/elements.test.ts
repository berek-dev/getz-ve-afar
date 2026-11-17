import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, validateElement, validateSupplier, whatsappNumber } from './elements.ts';

test('validateElement normalises a profile', () => {
  const r = validateElement({
    category: 'profile',
    name: ' פרופיל 60×40×2 ',
    unit: 'm',
    unit_cost: '22',
    weight_kg_per_unit: '3.014',
    stock_length_mm: '6000',
    supplier_id: '',
  });
  assert.deepEqual(r, {
    ok: true,
    value: {
      category: 'profile',
      name: 'פרופיל 60×40×2',
      unit: 'm',
      unit_cost: 22,
      weight_kg_per_unit: 3.014,
      stock_length_mm: 6000,
      supplier_id: null,
    },
  });
});

test('validateElement rejects bad input', () => {
  assert.equal(validateElement({ category: 'gold', name: 'x', unit: 'm', unit_cost: 1 }).ok, false);
  assert.equal(validateElement({ category: 'profile', name: '', unit: 'm', unit_cost: 1 }).ok, false);
  assert.equal(validateElement({ category: 'profile', name: 'x', unit: 'inch', unit_cost: 1 }).ok, false);
  assert.equal(validateElement({ category: 'profile', name: 'x', unit: 'm', unit_cost: -5 }).ok, false);
  assert.equal(validateElement({ category: 'profile', name: 'x', unit: 'm', unit_cost: 1, stock_length_mm: 6000.5 }).ok, false);
});

test('phones', () => {
  assert.equal(normalizePhone('050-123 4567'), '0501234567');
  assert.equal(normalizePhone('+972 50 123 4567'), '+972501234567');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('abc'), 'invalid');
  assert.equal(whatsappNumber('0501234567'), '972501234567');
  assert.equal(whatsappNumber('+972501234567'), '972501234567');
  assert.equal(whatsappNumber(null), null);
});

test('validateSupplier', () => {
  assert.deepEqual(validateSupplier({ name: 'ברזל הנגב', phone: '08-1234567' }), {
    ok: true,
    value: { name: 'ברזל הנגב', phone: '081234567', notes: null },
  });
  assert.equal(validateSupplier({ name: '' }).ok, false);
  assert.equal(validateSupplier({ name: 'x', phone: '12' }).ok, false);
});
