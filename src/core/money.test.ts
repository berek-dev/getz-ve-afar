import test from 'node:test';
import assert from 'node:assert/strict';
import { priceBreakdown, round2 } from './money.ts';

test('round2 handles float noise', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test('priceBreakdown applies overhead, margin and VAT in order', () => {
  const r = priceBreakdown({ materials: 1000, labor: 500, overheadPct: 10, marginPct: 20, vatPct: 18 });
  assert.equal(r.cost, 1500);
  assert.equal(r.overhead, 150);
  assert.equal(r.margin, 330); // 20% of 1650
  assert.equal(r.beforeVat, 1980);
  assert.equal(r.vat, 356.4);
  assert.equal(r.total, 2336.4);
});

test('priceBreakdown with zero markups equals cost + VAT', () => {
  const r = priceBreakdown({ materials: 100, labor: 0, overheadPct: 0, marginPct: 0, vatPct: 0 });
  assert.equal(r.total, 100);
});

test('priceBreakdown rejects negative input', () => {
  assert.throws(() => priceBreakdown({ materials: -1, labor: 0, overheadPct: 0, marginPct: 0, vatPct: 18 }), RangeError);
});
