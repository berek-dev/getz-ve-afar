import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSketchLine, eraseSketchLine, sketchToDesign } from './sketch.ts';
import type { SketchLine } from './sketch.ts';
import { guessCount, memberCutLengths, setSpacing } from './design.ts';

const TOL = 10;
const choice = { profile: 'rect_tube' as const, size: [60, 60, 3] };

/** Strokes in a row, each added the way the pad adds them */
function draw(strokes: [number, number, number, number][]): SketchLine[] {
  let lines: SketchLine[] = [];
  for (const [x1, y1, x2, y2] of strokes) lines = addSketchLine(lines, { x: x1, y: y1 }, { x: x2, y: y2 }, TOL) ?? lines;
  return lines;
}

test('a wobbly level stroke becomes level; a slanted one stays slanted', () => {
  const [level] = addSketchLine([], { x: 20, y: 103 }, { x: 220, y: 97 }, TOL) ?? [];
  assert.deepEqual(level, { a: { x: 20, y: 100 }, b: { x: 220, y: 100 } });
  const [plumb] = addSketchLine([], { x: 52, y: 300 }, { x: 48, y: 40 }, TOL) ?? [];
  assert.deepEqual(plumb, { a: { x: 50, y: 300 }, b: { x: 50, y: 40 } });
  const [brace] = addSketchLine([], { x: 0, y: 200 }, { x: 150, y: 50 }, TOL) ?? [];
  assert.deepEqual(brace, { a: { x: 0, y: 200 }, b: { x: 150, y: 50 } });
});

test('ends drawn near what is already there line up with it', () => {
  // A frame drawn freehand, corners missed by a few units
  const lines = draw([
    [50, 300, 52, 60],
    [46, 63, 248, 58],
    [251, 55, 247, 304],
    [55, 296, 245, 303],
  ]);
  assert.equal(lines.length, 4);
  const xs = new Set(lines.flatMap((l) => [l.a.x, l.b.x]));
  const ys = new Set(lines.flatMap((l) => [l.a.y, l.b.y]));
  assert.equal(xs.size, 2, 'two post lines');
  assert.equal(ys.size, 2, 'a top and a bottom');
  // A middle rail ending on the posts takes their lines
  const rail = addSketchLine(lines, { x: 58, y: 180 }, { x: 243, y: 184 }, TOL)?.at(-1);
  assert.ok(rail && xs.has(rail.a.x) && xs.has(rail.b.x));
  // A brace into a corner lands on the corner
  const corner = lines[0].b;
  const brace = addSketchLine(lines, { x: 240, y: 290 }, { x: corner.x + 4, y: corner.y - 3 }, TOL)?.at(-1);
  assert.deepEqual(brace?.b, corner);
});

test('a tap-sized or repeated line adds nothing', () => {
  const lines = draw([[0, 100, 200, 100]]);
  assert.equal(addSketchLine(lines, { x: 50, y: 50 }, { x: 58, y: 52 }, TOL), null);
  assert.equal(addSketchLine(lines, { x: 203, y: 98 }, { x: 2, y: 101 }, TOL), null, 'drawn again backwards');
});

test('a scribble removes the line it covers', () => {
  const lines = draw([
    [0, 100, 200, 100],
    [0, 0, 0, 100],
  ]);
  const scribble = [
    { x: 80, y: 104 },
    { x: 95, y: 97 },
    { x: 85, y: 103 },
    { x: 100, y: 96 },
  ];
  assert.deepEqual(eraseSketchLine(lines, scribble, 8), [lines[1]]);
  assert.equal(eraseSketchLine(lines, [{ x: 150, y: 20 }, { x: 160, y: 25 }], 8), null);
});

test('the drawing becomes a grid of guesses: lowest point on the ground, lines as members', () => {
  const lines = draw([
    [50, 300, 50, 60],
    [50, 60, 250, 60],
    [250, 60, 250, 300],
    [50, 180, 250, 180],
  ]);
  const d = sketchToDesign(lines, { mmPerUnit: 10, choice });
  assert.deepEqual(d.grid, { x: [2000], y: [1200, 1200], z: [] });
  assert.equal(d.members.length, 4);
  assert.deepEqual(
    d.members.map((m) => [m.a, m.b]),
    [
      [[0, 0, 0], [0, 2, 0]],
      [[0, 2, 0], [1, 2, 0]],
      [[1, 2, 0], [1, 0, 0]],
      [[0, 1, 0], [1, 1, 0]],
    ],
  );
  assert.equal(guessCount(d), 3);
  // Measuring the opening sets the scale: 3,000 wide makes the levels 1,800 each
  const measured = setSpacing(d, 'x', 0, 3000);
  assert.deepEqual(measured.grid, { x: [3000], y: [1800, 1800], z: [] });
  assert.equal(guessCount(measured), 2);
  assert.equal(memberCutLengths(measured).get(measured.members[1].id), 2940);
});

test('sizes are rounded; a single post still gets a grid; a busy drawing stays within 40 bays', () => {
  const post = sketchToDesign(draw([[100, 300, 100, 40]]), { mmPerUnit: 11.1, choice });
  assert.deepEqual(post.grid, { x: [1000], y: [2900], z: [] });
  assert.deepEqual(post.members.map((m) => [m.a, m.b]), [[[0, 0, 0], [0, 1, 0]]]);
  // 60 pickets an inch apart
  const pickets = Array.from({ length: 60 }, (_, i): [number, number, number, number] => [i * 5, 200, i * 5, 0]);
  const fence = sketchToDesign(draw(pickets), { mmPerUnit: 1, choice, step: 1 });
  assert.ok(fence.grid.x.length <= 40);
  assert.deepEqual(sketchToDesign([], { mmPerUnit: 10, choice }).members, []);
});
