import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutList, prepareScene } from './scene.ts';
import { checkModelAgainstBoq, keepTypedPrices, linesFromModel } from './modelBoq.ts';

const { scene } = prepareScene({
  members: [
    { id: 'post', label: 'עמוד', profile: 'rect_tube', size: [80, 80, 3], from: [40, -500, 0], to: [40, 1800, 0], repeat: { count: 2, step: [4080, 0, 0] } },
    { id: 'pk', label: 'מילוי', profile: 'rect_tube', size: [20, 40, 1.5], from: [0, 90, 0], to: [0, 1760, 0], repeat: { count: 15, between: [153, 2013], axis: 'x' } },
  ],
  plates: [{ center: [1000, 500, -10], size: [1800, 600], normal: 'z', thickness: 2 }],
  parts: [{ kind: 'hinge', at: [86, 250, 0], repeat: { count: 4, step: [0, 400, 0] } }, { kind: 'finial', at: [0, 2000, 0] }],
});
const cut = cutList(scene);

test('model and BOQ agree within 3%, differences come first', () => {
  const rows = checkModelAgainstBoq(cut, [
    { element_id: 1, element_name: 'פרופיל 80/80/3', description: 'עמוד', quantity: 4.6, unit: 'm', unit_cost: 55, length_mm: 2300, pieces: 2 },
    { element_id: 3, element_name: 'פרופיל 40/20/1.5', description: 'מילוי', quantity: 20, unit: 'm', unit_cost: 10, length_mm: 1670, pieces: 12 },
    { element_id: null, description: 'פלטה 10', quantity: 1, unit: 'm', unit_cost: 0, length_mm: 300, pieces: 2 },
    { element_id: 9, description: 'ציר', quantity: 4, unit: 'unit', unit_cost: 45, length_mm: null, pieces: null },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.name, r.status]),
    [
      ['פרופיל 40/20/1.5', 'differs'],
      ['פלטה 10', 'boq_only'],
      ['פרופיל 80/80/3', 'match'],
    ],
  );
  assert.equal(rows[0].modelPieces, 15);
  assert.equal(rows[0].boqPieces, 12);
});

test('lines from the model are priced from the price list by name and catalog key', () => {
  const lines = linesFromModel(scene, cut, [
    { id: 1, name: 'פרופיל 80/80/3', unit: 'm', unit_cost: 43.5, catalog_key: 'sq:black:80x80x3' },
    { id: 2, name: 'פח 2 מ״מ', unit: 'm2', unit_cost: 94.2, catalog_key: 'plate:black:2' },
    { id: 3, name: 'ציר כבד לשער', unit: 'unit', unit_cost: 45, catalog_key: 'item:hinge-heavy' },
  ]);
  const post = lines.find((l) => l.description.startsWith('עמוד'));
  assert.deepEqual(post, {
    element_id: 1,
    group_name: 'לפי ההדמיה',
    description: 'עמוד (B)',
    quantity: 4.6,
    unit: 'm',
    unit_cost: 43.5,
    length_mm: 2300,
    pieces: 2,
  });
  const infill = lines.find((l) => l.description.startsWith('מילוי'));
  assert.equal(infill?.element_id, null); // 40/20/1.5 not in this price list: priced later
  assert.equal(infill?.pieces, 15);
  assert.deepEqual(lines.find((l) => l.unit === 'm2'), { element_id: 2, group_name: 'לפי ההדמיה', description: 'פח 2 מ״מ 1800/600', quantity: 1.08, unit: 'm2', unit_cost: 94.2, length_mm: null, pieces: null });
  const hinge = lines.find((l) => l.element_id === 3);
  assert.equal(hinge?.description, 'ציר כבד לשער');
  assert.equal(hinge?.quantity, 4);
  assert.ok(lines.some((l) => l.description === 'קישוט ראש' && l.unit_cost === 0));
});

test('the demo gate model matches the demo job BOQ', async () => {
  const { readFileSync } = await import('node:fs');
  const demo = prepareScene(JSON.parse(readFileSync(new URL('../../seed/demo-model.json', import.meta.url), 'utf8')));
  assert.deepEqual(demo.errors, []);
  const rows = checkModelAgainstBoq(cutList(demo.scene), [
    { element_id: 9001, element_name: 'פרופיל 80/80/3', description: 'עמוד', quantity: 4.6, unit: 'm', unit_cost: 55, length_mm: 2300, pieces: 2 },
    { element_id: 9002, element_name: 'פרופיל 60/40/2', description: 'אנכיים', quantity: 7, unit: 'm', unit_cost: 22, length_mm: 1750, pieces: 4 },
    { element_id: 9002, element_name: 'פרופיל 60/40/2', description: 'אופקיים', quantity: 7.44, unit: 'm', unit_cost: 22, length_mm: 1860, pieces: 4 },
    { element_id: 9003, element_name: 'פרופיל 40/20/1.5', description: 'מילוי', quantity: 50.1, unit: 'm', unit_cost: 10, length_mm: 1670, pieces: 30 },
  ]);
  assert.deepEqual(rows.map((r) => r.status), ['match', 'match', 'match']);
});

test('approving a changed model keeps the prices typed on its lines where the price list has none', () => {
  const before = [
    { description: 'פרופיל 60/40/2 (A)', unit: 'm', unit_cost: 38, length_mm: 3000 },
    { description: 'קורה (B)', unit: 'm', unit_cost: 95, length_mm: 4000 },
    { description: 'פח 3 מ״מ 1,000/500', unit: 'm2', unit_cost: 210, length_mm: null },
    { description: 'פרופיל 100/100/3 (C)', unit: 'm', unit_cost: 0, length_mm: 2500 },
  ];
  const lines = [
    // The same profile cut to another length and marked differently: its price stays
    { description: 'פרופיל 60/40/2 (C)', unit: 'm' as const, unit_cost: 0, length_mm: 3200 },
    // A labelled piece at another length might be another profile now: no price carried
    { description: 'קורה (A)', unit: 'm' as const, unit_cost: 0, length_mm: 4200 },
    { description: 'פח 3 מ״מ 1,000/500', unit: 'm2' as const, unit_cost: 0, length_mm: null },
    // Priced by the price list: left as it is
    { description: 'פרופיל 100/100/3 (B)', unit: 'm' as const, unit_cost: 61, length_mm: 2500 },
  ];
  const kept = keepTypedPrices(lines, before, new Set(['פרופיל 60/40/2', 'פרופיל 100/100/3']));
  assert.deepEqual(kept.map((l) => l.unit_cost), [38, 0, 210, 61]);
});
