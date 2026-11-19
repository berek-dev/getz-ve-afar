import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addInfill,
  addMember,
  compileDesign,
  memberCutLengths,
  newDesign,
  parseSize,
  readDesign,
  removeLastBay,
  setSpacing,
  updateMember,
} from './design.ts';
import type { Design } from './design.ts';
import { cutList, prepareScene } from './scene.ts';

const col = { profile: 'rect_tube' as const, size: [100, 100, 4] };
const beam = { profile: 'rect_tube' as const, size: [100, 50, 3] };

function portal(): { d: Design; c1: string; c2: string; b: string } {
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [2500], z: [] } };
  const r1 = addMember(d, [0, 0, 0], [0, 1, 0], col);
  const r2 = addMember(r1.design, [1, 0, 0], [1, 1, 0], col);
  const r3 = addMember(r2.design, [0, 1, 0], [1, 1, 0], beam);
  d = r3.design;
  return { d, c1: r1.id as string, c2: r2.id as string, b: r3.id as string };
}

test('a portal frame: columns run to the top of the beam, the beam sits between the columns', () => {
  const { d, c1, b } = portal();
  const lengths = memberCutLengths(d);
  assert.equal(lengths.get(c1), 2550);
  assert.equal(lengths.get(b), 2900);
  const p = prepareScene(compileDesign(d, 'פורטל'));
  assert.deepEqual(p.errors, []);
  assert.equal(cutList(p.scene).pieces.length, 2);
});

test('a base plate lifts the column by its thickness and is drawn under it', () => {
  const { d, c1 } = portal();
  const withPlate = updateMember(d, c1, { base: { w: 200, d: 200, t: 10 } });
  assert.equal(memberCutLengths(withPlate).get(c1), 2540);
  const layout = compileDesign(withPlate, 'x') as { plates: { center: number[]; thickness: number }[] };
  assert.equal(layout.plates.length, 1);
  assert.deepEqual(layout.plates[0].center, [0, 5, 0]);
});

test('infill bars fill the gap between two rails, no gap wider than asked', () => {
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [1000], z: [] } };
  d = addMember(d, [0, 0, 0], [0, 1, 0], col).design;
  d = addMember(d, [1, 0, 0], [1, 1, 0], col).design;
  const bottom = addMember(d, [0, 0, 0], [1, 0, 0], beam);
  const top = addMember(bottom.design, [0, 1, 0], [1, 1, 0], beam);
  d = addInfill(top.design, [bottom.id as string, top.id as string], { profile: 'square_bar', size: [16] }, 100).design;
  const p = prepareScene(compileDesign(d, 'מעקה'));
  assert.deepEqual(p.errors, []);
  const bars = p.scene.members.filter((m) => m.label === 'מילוי');
  assert.equal(bars.length, 25); // 2,900 between the columns: 25 bars of 16, gaps of 96
  const xs = bars.map((m) => m.from[0]).sort((a, b) => a - b);
  const gap = xs[1] - xs[0] - 16;
  assert.ok(gap <= 100 && gap > 90, `gap ${gap}`);
  // From the bottom rail's top face to the top rail's underside
  assert.equal(Math.round(bars[0].from[1]), 50);
  assert.equal(Math.round(bars[0].to[1]), 950);
});

test('changing a bay moves everything on the far side; removing the last bay drops its members', () => {
  const { d } = portal();
  const wider = setSpacing(d, 'x', 0, 3500);
  assert.equal(memberCutLengths(wider).get(portal().b), undefined); // ids differ per call: check by shape instead
  const lengths = [...memberCutLengths(wider).values()].sort((a, b) => a - b);
  assert.deepEqual(lengths, [2550, 2550, 3400]);
  const grown = { ...wider, grid: { ...wider.grid, x: [3500, 2000] } };
  const extra = addMember(grown, [2, 0, 0], [2, 1, 0], col).design;
  const { design, removed } = removeLastBay(extra, 'x');
  assert.equal(removed, 1);
  assert.equal(design.members.length, 3);
});

test('sizes are typed the way the trade writes them', () => {
  assert.deepEqual(parseSize('rect_tube', '60/40/2'), [60, 40, 2]);
  assert.deepEqual(parseSize('rect_tube', '50/3'), [50, 50, 3]);
  assert.deepEqual(parseSize('flat', '40 5'), [40, 5]);
  assert.equal(parseSize('ipe', '123'), null);
  assert.deepEqual(parseSize('ipe', '200'), [200]);
  assert.equal(parseSize('round_bar', '0'), null);
});

test('a saved design reads back; junk does not', () => {
  const { d } = portal();
  const layout = compileDesign(d, 'x') as { design: unknown };
  assert.deepEqual(readDesign(JSON.parse(JSON.stringify(layout.design))), d);
  assert.equal(readDesign({ version: 1, grid: { x: [], y: [1], z: [] } }), null);
  assert.equal(readDesign(null), null);
});

test('grid chains measure bays along the top and levels down the left', () => {
  let d: Design = { ...newDesign(), grid: { x: [2000, 1500], y: [1000, 1200], z: [] } };
  d = addMember(d, [0, 0, 0], [0, 2, 0], col).design;
  const layout = compileDesign(d, 'x') as { dimensions: { from: number[]; to: number[] }[] };
  assert.equal(layout.dimensions.length, 4);
  assert.deepEqual(layout.dimensions[1], { from: [2000, 2200, 0], to: [3500, 2200, 0] });
});
