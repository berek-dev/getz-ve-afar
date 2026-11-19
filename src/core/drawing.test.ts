import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareScene } from './scene.ts';
import { memberOutline, shopDrawingSvg } from './drawing.ts';

const gate = prepareScene({
  title: 'שער בדיקה',
  members: [
    { id: 'post', profile: 'rect_tube', size: [100, 100, 4], from: [50, -600, 0], to: [50, 1900, 0] },
    { id: 's1', profile: 'rect_tube', size: [50, 50, 3], from: [140, 60, 0], to: [140, 1860, 0], group: 'leaf' },
    { id: 's2', profile: 'rect_tube', size: [50, 50, 3], from: [1140, 60, 0], to: [1140, 1860, 0], group: 'leaf' },
    { id: 'b', profile: 'rect_tube', size: [50, 50, 3], from: [165, 85, 0], to: [1115, 85, 0], group: 'leaf' },
    { id: 't', profile: 'rect_tube', size: [50, 50, 3], from: [165, 1835, 0], to: [1115, 1835, 0], group: 'leaf' },
    { id: 'pk', profile: 'rect_tube', size: [20, 20, 1.5], from: [0, 110, 0], to: [0, 1810, 0], group: 'leaf', repeat: { count: 7, between: [165, 1115], axis: 'x' } },
  ],
  groups: [{ id: 'leaf', label: 'כנף', motion: { type: 'swing', pivot: [107, 0, 0], angle: 90 } }],
  parts: [{ kind: 'footing', at: [50, -350, 0], size: [400, 700, 400] }, { kind: 'hinge', at: [107, 300, 0] }],
}).scene;

test('outline of a vertical post is its face width by its length', () => {
  const o = memberOutline(gate.members[0]);
  const xs = o.map((p) => p[0]);
  const ys = o.map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, 100, -600, 1900]);
});

test('shop drawing has the marks, dimensions, scale and title', () => {
  const svg = shopDrawingSvg(gate, { date: '18.11.2026' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('>שער בדיקה<'));
  for (const mark of ['>A<', '>B<', '>C<', '>D<']) assert.ok(svg.includes(mark), mark);
  assert.ok(svg.includes('>1165<'), 'overall width: post face 0 to stile face 1165');
  assert.ok(svg.includes('>1050<'), 'leaf width');
  assert.ok(svg.includes('>600<'), 'post depth below ground');
  assert.ok(/קנה מידה 1:\d+/.test(svg));
  assert.ok(!svg.includes('NaN'));
  // Printed on A4 the sheet is smaller than its scale: it says so
  assert.ok(/על A4 מוקטן \(1:\d+ על A3\)/.test(shopDrawingSvg(gate, { page: 'A4' })));
});
