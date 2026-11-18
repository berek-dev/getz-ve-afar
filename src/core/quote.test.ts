import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuoteSnapshot, effectiveQuoteStatus } from './quote.ts';
import type { QuoteLine } from './quote.ts';

const SETTINGS = {
  business_name: 'גץ ועפר',
  business_phone: '0501234567',
  overhead_pct: 10,
  margin_pct: 20,
  vat_pct: 18,
  bar_length_mm: 6000,
  kerf_mm: 3,
  quote_terms: '  מקדמה 30%  ',
  quote_valid_days: 14,
};

const base = { element_id: null, length_mm: null, pieces: null };
const LINES: QuoteLine[] = [
  { ...base, group_name: 'כנפיים', description: 'מילוי 40×20', quantity: 50.1, unit: 'm', unit_cost: 10, length_mm: 1670, pieces: 30, category: 'profile' },
  { ...base, group_name: 'פרזול', description: 'ציר כבד', quantity: 4, unit: 'unit', unit_cost: 45, category: 'hardware' },
  { ...base, group_name: 'עבודה', description: 'התקנה בשטח', quantity: 5, unit: 'hour', unit_cost: 180, category: 'labor' },
];

test('snapshot shows scope and price, hides costs and hours', () => {
  const s = buildQuoteSnapshot(
    { title: 'שער', kind: 'fabrication', client_name: 'כהן', site_address: null, description: null },
    LINES,
    SETTINGS,
  );
  assert.deepEqual(s.scope, [
    { group: 'כנפיים', lines: [{ text: 'מילוי 40×20', detail: '30 יח׳ באורך 1,670 מ״מ' }] },
    { group: 'פרזול', lines: [{ text: 'ציר כבד', detail: '4 יח׳' }] },
    { group: 'עבודה', lines: [{ text: 'התקנה בשטח', detail: null }] },
  ]);
  assert.equal(s.terms, 'מקדמה 30%');
  assert.equal(s.business.phone, '0501234567');
  // 10 bars × 6 m × 10 + 180 + 900 = 1680; ×1.1 ×1.2 = 2217.6; VAT 18%
  assert.equal(s.totals.beforeVat, 2217.6);
  assert.equal(s.totals.total, 2616.77);
  const json = JSON.stringify(s);
  assert.equal(json.includes('unit_cost'), false);
  assert.equal(json.includes('180'), false);
});

test('effective status', () => {
  assert.equal(effectiveQuoteStatus('sent', '2026-11-01', '2026-11-18'), 'expired');
  assert.equal(effectiveQuoteStatus('sent', '2026-12-01', '2026-11-18'), 'sent');
  assert.equal(effectiveQuoteStatus('approved', '2026-11-01', '2026-11-18'), 'approved');
});
