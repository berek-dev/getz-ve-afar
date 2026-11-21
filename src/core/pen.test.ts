import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBlock, addMember, insertGridLine, newDesign } from './design.ts';
import type { Design } from './design.ts';
import { classifyStroke, penSegment, scribbleTarget, snapToLine, straighten } from './pen.ts';
import type { P2 } from './pen.ts';

const line = (a: P2, b: P2, n = 20, wobble = 0): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n + (i % 2 ? wobble : -wobble) }));
const FRONT = { u: 'x', v: 'y', p: 'z' } as const;
const rect = { profile: 'rect_tube' as const, size: [60, 60, 3] };

test('strokes: a touch, a straight line, a scribble, a curve', () => {
  assert.deepEqual(classifyStroke([{ x: 10, y: 10 }, { x: 12, y: 11 }], 6), { kind: 'tap', at: { x: 10, y: 10 } });
  const drawn = classifyStroke(line({ x: 0, y: 0 }, { x: 200, y: 4 }, 30, 3), 6);
  assert.equal(drawn.kind, 'line');
  const zigzag: P2[] = [];
  for (let i = 0; i < 8; i++) zigzag.push({ x: i % 2 ? 60 : 0, y: i * 4 });
  assert.equal(classifyStroke(zigzag, 6).kind, 'scribble');
  const arc = Array.from({ length: 30 }, (_, i) => ({ x: 100 * Math.cos((i / 29) * Math.PI), y: 100 * Math.sin((i / 29) * Math.PI) }));
  assert.equal(classifyStroke(arc, 6).kind, 'other');
  assert.equal(classifyStroke([], 6).kind, 'other');
});

test('a scribble drifting along the line it covers is still a scribble', () => {
  // Up and down across a level line while moving right: the back and forth is on the shorter axis
  const across: P2[] = [];
  for (let i = 0; i <= 6; i++) across.push({ x: i * 14, y: i % 2 ? -30 : 30 });
  assert.equal(classifyStroke(across, 8).kind, 'scribble');
  // A wobbly straight line, an L and a U are not
  assert.equal(classifyStroke(line({ x: 0, y: 0 }, { x: 0, y: 200 }, 40, 4), 8).kind, 'line');
  assert.equal(classifyStroke([...line({ x: 0, y: 0 }, { x: 0, y: 100 }), ...line({ x: 0, y: 100 }, { x: 100, y: 100 })], 8).kind, 'other');
  const u = [...line({ x: 0, y: 0 }, { x: 0, y: 100 }), ...line({ x: 0, y: 100 }, { x: 60, y: 100 }), ...line({ x: 60, y: 100 }, { x: 60, y: 0 })];
  assert.equal(classifyStroke(u, 8).kind, 'other');
});

test('almost level or plumb lines are made exactly so', () => {
  assert.deepEqual(straighten({ x: 0, y: 0 }, { x: 1000, y: 60 }), { x: 1000, y: 0 });
  assert.deepEqual(straighten({ x: 0, y: 0 }, { x: 50, y: 900 }), { x: 0, y: 900 });
  assert.deepEqual(straighten({ x: 0, y: 0 }, { x: 500, y: 400 }), { x: 500, y: 400 }); // a brace stays a brace
});

test('a coordinate snaps to a near line, or asks for a new one rounded to 10 mm', () => {
  assert.deepEqual(snapToLine(2980, [0, 3000], 50), { index: 1 });
  assert.deepEqual(snapToLine(1234, [0, 3000], 50), { insert: 1230 });
});

test('a new grid line splits a bay and keeps every drawn part where it was', () => {
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [2000], z: [] } };
  d = addMember(d, [0, 1, 0], [1, 1, 0], rect).design;
  d = addBlock(d, 'railing', [0, 1, 0], [1, 1, 0]).design;
  const split = insertGridLine(d, 'x', 1200);
  assert.equal(split.index, 1);
  assert.deepEqual(split.design.grid.x, [1200, 1800]);
  assert.deepEqual(split.design.members[0].b, [2, 1, 0]); // still the right-hand end, at 3,000
  assert.deepEqual(split.design.blocks[0].b, [2, 1, 0]);
  assert.equal(insertGridLine(split.design, 'x', 1200.3).design, split.design); // already there: nothing changes
  const past = insertGridLine(d, 'x', 3500);
  assert.deepEqual([past.design.grid.x, past.index], [[3000, 500], 2]);
  const before = insertGridLine(d, 'x', -400);
  assert.deepEqual([before.design.grid.x, before.index, before.design.members[0].a], [[400, 3000], 0, [1, 1, 0]]);
  assert.deepEqual(insertGridLine(d, 'y', -300).index, 0); // never below the ground
  const deep = insertGridLine(d, 'z', 800);
  assert.deepEqual([deep.design.grid.z, deep.index], [[800], 1]);
});

test('a pen line becomes two grid points, adding lines where it ends off the grid', () => {
  const d: Design = { ...newDesign(), grid: { x: [3000], y: [2000], z: [] } };
  const onGrid = penSegment(d, FRONT, 0, { u: 20, v: 30 }, { u: 2990, v: 2010 }, 60);
  assert.deepEqual([onGrid.a, onGrid.b, onGrid.added], [[0, 0, 0], [1, 1, 0], 0]);
  // A beam drawn at about 1,203 high, a little off level, ending past the grid at 4,000
  const off = penSegment(d, FRONT, 0, { u: 10, v: 1203 }, { u: 4004, v: 1250 }, 60);
  assert.deepEqual(off.design.grid.y, [1200, 800]);
  assert.deepEqual(off.design.grid.x, [3000, 1000]);
  assert.deepEqual([off.a, off.b, off.added], [[0, 1, 0], [2, 1, 0], 2]);
});

test('a scribble erases the piece most of it covers', () => {
  const segs = [
    { id: 'm1', x1: 0, y1: 0, x2: 100, y2: 0, w: 4 },
    { id: 'm2', x1: 0, y1: 50, x2: 100, y2: 50, w: 4 },
  ];
  const scribble = line({ x: 20, y: 2 }, { x: 80, y: -2 }, 10, 3);
  assert.equal(scribbleTarget(scribble, segs, 6), 'm1');
  assert.equal(scribbleTarget([{ x: 50, y: 25 }, { x: 52, y: 26 }, { x: 54, y: 24 }], segs, 6), null);
});

test('a finger scribble crossing a piece erases it, though few of its points are near it', () => {
  const segs = [
    { id: 'post', x1: 100, y1: 0, x2: 100, y2: 200, w: 4 },
    { id: 'beam', x1: 0, y1: 200, x2: 200, y2: 200, w: 4 },
  ];
  // Wide strokes across the post, sampled densely where the finger slows down to turn
  const scribble: P2[] = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const y = 60 + i * 12;
    for (const f of [0.95, 1, 0.9]) scribble.push({ x: 100 + side * 40 * f, y });
  }
  const near = scribble.filter((p) => Math.abs(p.x - 100) <= 8).length;
  assert.equal(near, 0, 'no point lies on the post');
  assert.equal(scribbleTarget(scribble, segs, 6), 'post');
  // One pass over a piece is not a scribble on it
  assert.equal(scribbleTarget([{ x: 60, y: 60 }, { x: 140, y: 64 }], segs, 6), null);
  // Over a corner, the piece crossed most wins
  const corner: P2[] = [];
  for (let i = 0; i < 6; i++) corner.push({ x: i % 2 ? 120 : 80, y: 150 + i * 4 });
  corner.push({ x: 90, y: 215 });
  assert.equal(scribbleTarget(corner, segs, 6), 'post');
});
