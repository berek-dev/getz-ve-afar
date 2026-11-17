import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobBalance, monthCsv, monthRange, shiftMonth, vatFromGross } from './finance.ts';

test('VAT part of a gross amount', () => {
  assert.equal(vatFromGross(1180, 18), 180);
  assert.equal(vatFromGross(100, 0), 0);
});

test('job balance against the approved total', () => {
  assert.deepEqual(jobBalance(9440.61, [{ amount: 3000 }, { amount: 1000 }]), {
    due: 9440.61,
    paid: 4000,
    balance: 5440.61,
    share: 4000 / 9440.61,
  });
  assert.equal(jobBalance(null, [{ amount: 50 }]).balance, null);
});

test('month helpers', () => {
  assert.deepEqual(monthRange('2026-12'), ['2026-12-01', '2027-01-01']);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-11', 1), '2026-12');
});

test('CSV: BOM, sorted by date, quoted cells, no formula injection', () => {
  const csv = monthCsv(
    [{ id: 1, job_id: 1, amount: 3000, method: 'bit', paid_at: '2026-11-20', notes: 'מקדמה, 30%', job_title: 'שער', client_name: 'כהן' }],
    [{ id: 1, job_id: 1, supplier_id: null, category: 'materials', amount: 1180, vat: 180, spent_at: '2026-11-02', receipt_key: 'r/1', notes: '=HYPERLINK("x")', job_title: 'שער', supplier_name: 'ברזל' }],
  );
  assert.ok(csv.startsWith('﻿תאריך,'));
  const rows = csv.trim().split('\r\n');
  assert.equal(rows.length, 3);
  assert.ok(rows[1].startsWith('2026-11-02,הוצאה,1180,180,שער,ברזל,חומרים,"\'=HYPERLINK(""x"")",יש'));
  assert.ok(rows[2].includes('"מקדמה, 30%"'));
});
