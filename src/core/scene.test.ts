import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcPoint, arcThrough, cutList, markLabel, memberLength, prepareScene, sectionAxes, sectionName } from './scene.ts';
import { catalogItems } from './catalog.ts';

const close = (a: number, b: number, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('section axes: rails face up, posts face X', () => {
  assert.deepEqual(sectionAxes([1, 0, 0]).f.map((x) => Math.round(x) + 0), [0, 1, 0]);
  assert.deepEqual(sectionAxes([0, 5, 0]), { f: [1, 0, 0], n: [0, 0, 1] });
  const pergolaBeam = sectionAxes([0, 0, 1]);
  assert.deepEqual(pergolaBeam.f.map((x) => Math.round(x) + 0), [0, 1, 0]);
});

test('arc through three points: a half circle', () => {
  const arc = arcThrough([0, 0, 0], [1000, 1000, 0], [2000, 0, 0]);
  assert.ok(arc);
  close(arc.radius, 1000, 1e-6);
  close(arc.sweep, Math.PI, 1e-9);
  const mid = arcPoint(arc, 0.5);
  close(mid[0], 1000, 1e-6);
  close(mid[1], 1000, 1e-6);
  close(memberLength({ from: [0, 0, 0], via: [1000, 1000, 0], to: [2000, 0, 0] }), Math.PI * 1000, 1e-6);
  assert.equal(arcThrough([0, 0, 0], [1, 0, 0], [2, 0, 0]), null);
});

test('repeat spreads pickets evenly between the stiles', () => {
  const { scene, errors } = prepareScene({
    members: [{ id: 'p', profile: 'rect_tube', size: [20, 20, 1.5], from: [0, 110, 0], to: [0, 1810, 0], repeat: { count: 4, between: [0, 1000], axis: 'x' } }],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(scene.members.map((m) => m.from[0]), [200, 400, 600, 800]);
  assert.deepEqual(scene.members.map((m) => m.id), ['p#1', 'p#2', 'p#3', 'p#4']);
});

test('pickets trimmed to an arch stop at its underside', () => {
  const { scene, warnings } = prepareScene({
    members: [
      { id: 'arch', profile: 'rect_tube', size: [50, 50, 3], from: [0, 1500, 0], via: [2000, 1800, 0], to: [4000, 1500, 0] },
      { id: 'pk', profile: 'rect_tube', size: [20, 20, 2], from: [2000, 100, 0], to: [2000, 3000, 0], trim_to: 'arch' },
      { id: 'side', profile: 'rect_tube', size: [20, 20, 2], from: [500, 100, 0], to: [500, 3000, 0], trim_to: 'arch' },
    ],
  });
  assert.deepEqual(warnings, []);
  const pk = scene.members.find((m) => m.id === 'pk');
  close(pk?.to[1] ?? 0, 1775, 0.5); // apex 1800 minus half of 50
  const side = scene.members.find((m) => m.id === 'side');
  assert.ok((side?.to[1] ?? 0) > 1500 && (side?.to[1] ?? 0) < 1775);
});

test('trim to a straight rail stops at its face', () => {
  const { scene } = prepareScene({
    members: [
      { id: 'top', profile: 'rect_tube', size: [60, 40, 2], from: [0, 1800, 0], to: [2000, 1800, 0] },
      { id: 'pk', profile: 'flat', size: [40, 5], from: [1000, 100, 0], to: [1000, 2500, 0], trim_to: 'top' },
    ],
  });
  close(scene.members[1].to[1], 1770, 0.01); // rail is 60 high, centre 1800
});

test('bad items are dropped with warnings, not fatal', () => {
  const { scene, warnings, errors } = prepareScene({
    members: [
      { profile: 'rect_tube', size: [40, 40, 2], from: [0, 0, 0], to: [0, 1000, 0] },
      { profile: 'banana', size: [1], from: [0, 0, 0], to: [1, 1, 1] },
      { profile: 'ipe', size: [123], from: [0, 0, 0], to: [1000, 0, 0] },
      { profile: 'flat', size: [40, 5], from: [0, 0, 0], to: [0, 0, 0] },
    ],
    groups: [{ id: 'leaf', motion: { type: 'swing', pivot: [0, 0, 0], angle: 90 } }],
    parts: [{ kind: 'hinge', at: [0, 300, 0], group: 'nope' }],
  });
  assert.equal(scene.members.length, 1);
  assert.equal(warnings.length, 4);
  assert.deepEqual(errors, []);
  assert.equal(prepareScene({ members: [] }).errors.length, 1);
});

test('cut list groups identical pieces under one mark, named like the price list', () => {
  const { scene } = prepareScene({
    members: [
      { profile: 'rect_tube', size: [50, 50, 3], from: [25, 60, 0], to: [25, 1860, 0] },
      { profile: 'rect_tube', size: [50, 50, 3], from: [975, 60, 0], to: [975, 1860, 0] },
      { profile: 'rect_tube', size: [50, 50, 3], from: [50, 85, 0], to: [950, 85, 0] },
      { profile: 'rect_tube', size: [20, 20, 1.5], from: [0, 110, 0], to: [0, 1810, 0], repeat: { count: 7, between: [50, 950], axis: 'x' } },
    ],
    plates: [{ center: [500, 500, -20], size: [900, 600], normal: 'z', thickness: 2 }],
    parts: [{ kind: 'hinge', at: [0, 300, 0], repeat: { count: 2, step: [0, 1200, 0] } }],
  });
  const cut = cutList(scene);
  assert.deepEqual(
    cut.pieces.map((p) => [p.mark, p.name, p.length, p.count]),
    [
      ['A', 'פרופיל 20/20/1.5', 1700, 7],
      ['B', 'פרופיל 50/50/3', 1800, 2],
      ['C', 'פרופיל 50/50/3', 900, 1],
    ],
  );
  assert.deepEqual(cut.parts, [{ kind: 'hinge', label: 'ציר', count: 2 }]);
  assert.equal(cut.plates[0].areaM2, 0.54);
  assert.ok(cut.totalKg > 20 && cut.totalKg < 40, String(cut.totalKg));
  assert.equal(markLabel(26), 'AA');
});

test('section names match catalog item names', () => {
  const names = new Set(catalogItems().map((i) => i.name));
  for (const n of [
    sectionName('rect_tube', [40, 60, 2], 'galv'),
    sectionName('angle', [40, 40, 4], 'black'),
    sectionName('round_tube', [48.3, 2.9], 'black'),
    sectionName('round_bar', [12], 'black'),
    sectionName('square_bar', [12], 'black'),
    sectionName('flat', [40, 5], 'black'),
    sectionName('ipe', [200], 'black'),
    sectionName('upn', [100], 'black'),
  ]) {
    assert.ok(names.has(n), n);
  }
});

test('dimensions are measured from the geometry; a label is only a name', async () => {
  const { dimensionLines, dimensionName } = await import('./scene.ts');
  assert.equal(dimensionName('פתח 4,000'), null);
  assert.equal(dimensionName('קטע מוחלף'), 'קטע מוחלף');
  const { scene } = prepareScene({
    members: [
      { id: 'p1', profile: 'rect_tube', size: [80, 80, 3], from: [40, -500, 0], to: [40, 1800, 0] },
      { id: 'l1', group: 'g', profile: 'rect_tube', size: [40, 40, 2], from: [100, 50, 0], to: [100, 1750, 0] },
      { id: 'l2', group: 'g', profile: 'rect_tube', size: [40, 40, 2], from: [1100, 50, 0], to: [1100, 1750, 0] },
    ],
    groups: [{ id: 'g', motion: { type: 'swing', pivot: [80, 0, 0], angle: 90 } }],
    dimensions: [{ from: [0, 0, 0], to: [2500, 0, 0], label: 'פתח 4,000' }],
  });
  assert.deepEqual(
    dimensionLines(scene).map((d) => [d.axis, d.mm, d.name]),
    [
      ['x', 1040, null],
      ['x', 1120, null],
      ['y', 1800, null],
      ['x', 2500, null],
    ],
  );
});

test('a measurement between two posts follows them when the gate gets wider', async () => {
  const { anchorDimensions, dimensionLines, prepareScene } = await import('./scene.ts');
  const post = (id: string, x: number) => ({ id, profile: 'rect_tube', size: [80, 80, 3], from: [x, -600, 0], to: [x, 1250, 0] });
  const gate = (rightX: number, dims: unknown[]) => ({
    version: 1,
    title: 'שער',
    members: [post('post-l', 40), post('post-r', rightX), { id: 'rail', profile: 'rect_tube', size: [40, 20, 2], from: [100, 900, 0], to: [rightX - 60, 900, 0] }],
    dimensions: dims,
  });
  // As Gemini wrote it: two fixed points on the posts' inner sides, 1.5 m apart
  const narrow = gate(1620, [{ from: [80, 15, 200], to: [1580, 15, 200], label: 'פתח' }, { from: [0, 0, 0], to: [500, 0, 0], label: 'משהו' }]);
  const anchored = anchorDimensions(narrow) as { dimensions: unknown[] };
  assert.deepEqual(anchored.dimensions[0], { between: ['post-l', 'post-r'], label: 'פתח' });
  assert.deepEqual(anchored.dimensions[1], { from: [0, 0, 0], to: [500, 0, 0], label: 'משהו' }); // touches nothing: left alone
  // The edit moves the right post to make a 3 m opening and keeps the measurement as it was
  const wide = prepareScene({ ...gate(3120, []), dimensions: anchored.dimensions });
  assert.deepEqual(wide.errors, []);
  const opening = dimensionLines(wide.scene).find((d) => d.name === 'פתח');
  assert.equal(opening?.mm, 3000);
});

test('a measurement between parts that do not exist is dropped with a warning', async () => {
  const { prepareScene } = await import('./scene.ts');
  const p = prepareScene({
    version: 1,
    title: 't',
    members: [{ id: 'a', profile: 'rect_tube', size: [40, 40, 2], from: [0, 0, 0], to: [0, 1000, 0] }],
    dimensions: [{ between: ['a', 'nope'], label: 'x' }],
  });
  assert.equal(p.scene.dimensions?.length, 0);
  assert.equal(p.warnings.length, 1);
});
