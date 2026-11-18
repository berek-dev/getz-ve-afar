import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeJob } from './quantities.ts';
import { barsText, buildOrders, orderMessage } from './purchasing.ts';
import type { OrderItem } from './purchasing.ts';

const settings = { overhead_pct: 10, margin_pct: 20, vat_pct: 18, bar_length_mm: 6000, kerf_mm: 3 };

const iron = { supplier_id: 1, supplier_name: 'ברזל בע״מ', supplier_phone: '0501234567' };
const shop = { supplier_id: 2, supplier_name: 'פרזול', supplier_phone: null };

function line(p: Partial<OrderItem>): OrderItem {
  return { element_id: null, description: 'x', quantity: 1, unit: 'unit', unit_cost: 0, length_mm: null, pieces: null, ...p };
}

const items: OrderItem[] = [
  line({ element_id: 2, element_name: '60/40/2', category: 'profile', description: 'אנכי', quantity: 7, unit: 'm', unit_cost: 22, length_mm: 1750, pieces: 4, stock_length_mm: 6000, ...iron }),
  line({ element_id: 2, element_name: '60/40/2', category: 'profile', description: 'אופקי', quantity: 7.44, unit: 'm', unit_cost: 22, length_mm: 1860, pieces: 4, stock_length_mm: 6000, ...iron }),
  line({ element_id: 4, element_name: 'ציר כבד', category: 'hardware', description: 'ציר', quantity: 2, unit: 'unit', unit_cost: 45, ...shop }),
  line({ element_id: 4, element_name: 'ציר כבד', category: 'hardware', description: 'ציר נוסף', quantity: 2, unit: 'unit', unit_cost: 45, ...shop }),
  line({ element_id: 10, category: 'labor', description: 'ייצור', quantity: 14, unit: 'hour', unit_cost: 180 }),
  line({ element_id: 11, category: 'other', description: 'הובלה', quantity: 1, unit: 'unit', unit_cost: 250 }),
  line({ element_id: 13, category: 'equipment', description: 'רתכת – יום', quantity: 1, unit: 'day', unit_cost: 400 }),
  line({ description: 'פלטה 10 מ״מ', quantity: 1.6, unit: 'm', unit_cost: 30, length_mm: 400, pieces: 4 }),
];

test('orders group by supplier, profiles in whole bars, labor and own equipment skipped', () => {
  const { cutPlans } = computeJob(items, settings);
  const orders = buildOrders(items, cutPlans);
  assert.deepEqual(
    orders.map((o) => o.supplierName),
    ['ברזל בע״מ', 'פרזול', null],
  );
  const [ironOrder, shopOrder, none] = orders;
  assert.deepEqual(ironOrder.lines, [{ name: '60/40/2', qty: '3 מוטות של 6 מ׳', note: null }]);
  assert.equal(ironOrder.cost, 396); // 3 bars × 6 m × 22
  assert.deepEqual(shopOrder.lines, [{ name: 'ציר כבד', qty: '4 יח׳', note: null }]);
  assert.equal(shopOrder.cost, 180);
  assert.deepEqual(none.lines, [{ name: 'פלטה 10 מ״מ', qty: 'מוט אחד של 6 מ׳', note: null }]);
});

test('pieces longer than a bar are called out', () => {
  const long = [line({ description: 'קורה', quantity: 7.2, unit: 'm', unit_cost: 10, length_mm: 7200, pieces: 1 })];
  const [order] = buildOrders(long, computeJob(long, settings).cutPlans);
  assert.equal(order.lines[0].note, 'ועוד חתיכה אחת ארוכה ממוט: 7.2 מ׳');
});

test('supplier message has the lines and no client details', () => {
  const { cutPlans } = computeJob(items, settings);
  const msg = orderMessage(buildOrders(items, cutPlans)[0], { businessName: 'גץ ועפר', jobTitle: 'שער' });
  assert.equal(msg.split('\n')[0], 'שלום ברזל בע״מ, הזמנה מגץ ועפר (עבור שער):');
  assert.ok(msg.includes('• 60/40/2: 3 מוטות של 6 מ׳'));
  assert.equal(barsText(1, 6000), 'מוט אחד של 6 מ׳');
});
