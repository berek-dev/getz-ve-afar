import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHEETS, SHEET_KEYS, TINTS, isSheet, purlinGap, sheetCount, sheetInfo, sheetName, sheetTint } from './sheets.ts';
import { catalogItems } from './catalog.ts';

test('roofing sheets: unique keys, names with the tint, a tint they come in', () => {
  assert.equal(new Set(SHEET_KEYS).size, SHEETS.length);
  assert.ok(SHEETS.every((s) => s.kgPerM2 > 0 && s.depth >= s.thickness && s.tints.length > 0));
  assert.equal(sheetName('pc_trapeze', 'bronze'), 'סנטף מלבני (טרפז 76/16), פוליקרבונט 0.8 מ״מ, ברונזה');
  // A tint the sheet doesn't come in falls back to its first one
  assert.equal(sheetTint('pc_multiwall_10', 'gray'), 'clear');
  assert.equal(sheetTint('pc_multiwall_10', 'nonsense'), 'clear');
  assert.equal(sheetInfo('pc_solid_5')?.kgPerM2, 6);
  assert.ok(isSheet('pvc_corrugated') && !isSheet('steel'));
  assert.ok(Object.values(TINTS).every((t) => t.opacity > 0 && t.opacity < 1));
});

test('how many sheets cover a width, by the width each one covers', () => {
  // Trapeze sheets are 1,260 wide and cover 1,216 once overlapped: 4,000 needs 4
  assert.equal(sheetCount('pc_trapeze', 4000), 4);
  assert.equal(sheetCount('pc_trapeze', 1260), 1);
  assert.equal(sheetCount('pc_trapeze', 1261), 2);
  assert.equal(sheetCount('pc_trapeze', 2476), 2);
  assert.equal(sheetCount('pc_trapeze', 2477), 3);
  // No width given for PVC: no count
  assert.equal(sheetCount('pvc_corrugated', 3000), null);
});

test('purlins: the widest gap against the maker’s span, end spans stricter', () => {
  // Trapeze: 1,200 between inner purlins, 900 at the ends
  assert.deepEqual(purlinGap('pc_trapeze', [0, 900, 2100, 3000]), { gap: 900, limit: 900, ok: true });
  assert.deepEqual(purlinGap('pc_trapeze', [0, 800, 2100, 2900]), { gap: 1300, limit: 1200, ok: false });
  assert.deepEqual(purlinGap('pc_trapeze', [0, 1500]), { gap: 1500, limit: 900, ok: false });
  // No spans given for multiwall, or nothing to measure
  assert.equal(purlinGap('pc_multiwall_10', [0, 3000]), null);
  assert.equal(purlinGap('pc_trapeze', [500]), null);
});

test('every sheet is in the catalog, priced per m², under plates', () => {
  const items = catalogItems().filter((i) => i.key.startsWith('sheet:'));
  assert.deepEqual(items.map((i) => i.key.slice(6)).sort(), [...SHEET_KEYS].sort());
  assert.ok(items.every((i) => i.unit === 'm2' && i.category === 'plate' && i.by_kg === 0 && i.weight && i.family === 'קירוי: סנטף ופוליקרבונט'));
  assert.equal(new Set(catalogItems().map((i) => i.key)).size, catalogItems().length);
});
