import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, catalogItems, familyDef } from './catalog.ts';

const items = catalogItems();

test('catalog is rich and every key and name is unique', () => {
  assert.ok(items.length > 400, `only ${items.length} items`);
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
  const names = items.map((i) => i.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dupes, []);
});

test('every item belongs to a known family of the same category', () => {
  for (const i of items) {
    const f = familyDef(i.family);
    assert.ok(f, i.family);
    assert.equal(f.category, i.category, i.name);
  }
  assert.equal(new Set(FAMILIES.map((f) => f.family)).size, FAMILIES.length);
});

test('names, sizes and weights for common items', () => {
  const by = (key: string) => items.find((i) => i.key === key);
  assert.equal(by('rect:black:60x40x2')?.name, 'פרופיל 60/40/2');
  assert.equal(by('rect:galv:60x40x2')?.name, 'פרופיל 60/40/2 מגולוון');
  assert.equal(by('rect:black:60x40x2')?.weight, 3.014);
  assert.equal(by('sq:black:80x80x3')?.name, 'פרופיל 80/80/3');
  assert.ok(Math.abs((by('sq:aluminum:40x40x2')?.weight ?? 0) - 0.821) < 0.001);
  assert.equal(by('water:black:219.1x6.35')?.name, 'צינור פלדה 8 צול (219.1/6.35)');
  assert.equal(by('water:black:219.1x6.35')?.stock, 12000);
  assert.equal(by('plate:black:3')?.unit, 'm2');
  assert.equal(by('plate:black:3')?.weight, 23.55);
  assert.equal(by('ipe:black:200')?.weight, 22.4);
  assert.equal(by('item:hinge-heavy')?.by_kg, 0);
});

test('no characters that flip numbers in right-to-left text', () => {
  for (const i of items) assert.ok(!/[×°½¼¾"″]/.test(i.name) && !/[×°½¼¾"″]/.test(i.size ?? ''), i.name);
});

test('galvanized stops at 4 mm walls; only metal stock is priced by weight', () => {
  assert.equal(items.find((i) => i.key === 'sq:galv:150x150x5'), undefined);
  for (const i of items) assert.equal(i.by_kg === 1, i.material !== null && i.weight !== null, i.name);
});
