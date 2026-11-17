import test from 'node:test';
import assert from 'node:assert/strict';
import { computeJob, isCutLine, isLaborLine, planCuts } from './quantities.ts';
import type { QuantityLine } from './quantities.ts';

const SETTINGS = { overhead_pct: 10, margin_pct: 20, vat_pct: 18, bar_length_mm: 6000, kerf_mm: 3 };

// The demo gate from seed/demo.sql (fictional prices)
function line(partial: Partial<QuantityLine> & Pick<QuantityLine, 'description' | 'quantity' | 'unit' | 'unit_cost'>): QuantityLine {
  return { element_id: null, length_mm: null, pieces: null, ...partial };
}
const GATE: QuantityLine[] = [
  line({ element_id: 9001, description: 'עמוד 80×80×3', quantity: 4.6, unit: 'm', unit_cost: 55, length_mm: 2300, pieces: 2, category: 'profile', weight_kg_per_unit: 7.25, stock_length_mm: 6000 }),
  line({ element_id: 9002, element_name: 'פרופיל 60×40×2', description: 'מסגרת 60×40×2 – אנכיים', quantity: 7.0, unit: 'm', unit_cost: 22, length_mm: 1750, pieces: 4, category: 'profile', weight_kg_per_unit: 3.01, stock_length_mm: 6000 }),
  line({ element_id: 9002, description: 'מסגרת 60×40×2 – אופקיים', quantity: 7.44, unit: 'm', unit_cost: 22, length_mm: 1860, pieces: 4, category: 'profile', weight_kg_per_unit: 3.01, stock_length_mm: 6000 }),
  line({ element_id: 9003, description: 'מילוי 40×20×1.5', quantity: 50.1, unit: 'm', unit_cost: 10, length_mm: 1670, pieces: 30, category: 'profile', weight_kg_per_unit: 1.34, stock_length_mm: 6000 }),
  line({ element_id: 9004, description: 'ציר כבד', quantity: 4, unit: 'unit', unit_cost: 45, category: 'hardware' }),
  line({ element_id: 9005, description: 'בריח רצפה', quantity: 1, unit: 'unit', unit_cost: 60, category: 'hardware' }),
  line({ element_id: 9006, description: 'מנעול + ידית', quantity: 1, unit: 'unit', unit_cost: 180, category: 'hardware' }),
  line({ element_id: 9009, description: 'מתכלים', quantity: 1, unit: 'unit', unit_cost: 120, category: 'other' }),
  line({ element_id: 9007, description: 'צביעה בתנור', quantity: 7, unit: 'm2', unit_cost: 55, category: 'finish' }),
  line({ element_id: 9008, description: 'בטון מהיר', quantity: 4, unit: 'unit', unit_cost: 35, category: 'other' }),
  line({ element_id: 9011, description: 'הובלה', quantity: 1, unit: 'unit', unit_cost: 250, category: 'other' }),
  line({ element_id: 9010, description: 'ייצור', quantity: 14, unit: 'hour', unit_cost: 180, category: 'labor' }),
  line({ element_id: 9010, description: 'התקנה', quantity: 5, unit: 'hour', unit_cost: 180, category: 'labor' }),
];

test('planCuts packs longest first and loses the kerf between pieces', () => {
  const { bars, oversize } = planCuts([1750, 1750, 1750, 1750, 1860, 1860, 1860, 1860], 6000, 3);
  assert.equal(bars.length, 3);
  assert.deepEqual(bars[0]?.pieces, [1860, 1860, 1860]);
  assert.equal(bars[0]?.used, 1860 * 3 + 2 * 3);
  assert.equal(bars[0]?.offcut, 6000 - 5586);
  assert.deepEqual(oversize, []);
});

test('planCuts: kerf can push a piece to the next bar', () => {
  // 3000 + 3 + 3000 > 6000, so two bars
  assert.equal(planCuts([3000, 3000], 6000, 3).bars.length, 2);
  assert.equal(planCuts([3000, 3000], 6000, 0).bars.length, 1);
});

test('planCuts flags pieces longer than a bar', () => {
  const { bars, oversize } = planCuts([7000, 2000], 6000, 3);
  assert.deepEqual(oversize, [7000]);
  assert.equal(bars.length, 1);
});

test('line classification', () => {
  assert.equal(isLaborLine({ ...GATE[11]! }), true);
  assert.equal(isLaborLine(line({ description: 'תפר 8"', quantity: 6, unit: 'joint', unit_cost: 480, category: 'weld' })), true);
  assert.equal(isLaborLine({ ...GATE[4]! }), false);
  assert.equal(isCutLine({ ...GATE[0]! }), true);
  assert.equal(isCutLine(line({ description: 'פרופיל במטרים', quantity: 3, unit: 'm', unit_cost: 10 })), false);
});

test('demo gate: cut list, bars bought, weight and price', () => {
  const t = computeJob(GATE, SETTINGS);

  const bars = Object.fromEntries(t.cutPlans.map((p) => [p.key, p.bars.length]));
  assert.deepEqual(bars, { e9001: 1, e9002: 3, e9003: 10 }); // 14 bars, 84 m bought for 69.14 m net
  assert.equal(t.cutPlans[1]?.name, 'פרופיל 60×40×2'); // library name, not the first line's description

  // Profiles by bars: 6m×55 + 18m×22 + 60m×10 = 1326; other materials 1315
  assert.equal(t.materials, 2641);
  assert.equal(t.materialsNet, 2386.68);
  assert.equal(t.labor, 3420);
  assert.equal(t.weightKg, 143.95); // 4.6×7.25 + 14.44×3.01 + 50.1×1.34

  assert.equal(t.price.cost, 6061);
  assert.equal(t.price.overhead, 606.1);
  assert.equal(t.price.margin, 1333.42);
  assert.equal(t.price.beforeVat, 8000.52);
  assert.equal(t.price.vat, 1440.09);
  assert.equal(t.price.total, 9440.61);
});

test('lines without a library element are grouped by description', () => {
  const t = computeJob(
    [
      line({ description: 'זווית 40', quantity: 3, unit: 'm', unit_cost: 8, length_mm: 1000, pieces: 3 }),
      line({ description: 'זווית 40', quantity: 3, unit: 'm', unit_cost: 8, length_mm: 1000, pieces: 3 }),
    ],
    SETTINGS,
  );
  assert.equal(t.cutPlans.length, 1);
  assert.equal(t.cutPlans[0]?.bars.length, 2); // 6×1000 + 5×3 kerf = 6015 > 6000
});

test('empty job costs nothing', () => {
  const t = computeJob([], SETTINGS);
  assert.equal(t.price.total, 0);
  assert.deepEqual(t.cutPlans, []);
});
