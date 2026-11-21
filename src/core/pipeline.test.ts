/**
 * End to end through the pure code: a sketch reading or pen strokes become a design, the design a 3D layout, the
 * layout a cut list, price lines, a shop drawing and a PDF. Each stage has to agree with the one before it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { designFromReply } from './designPrompt.ts';
import { addBlock, compileDesign, guessCount, newDesign, readDesign, setSpacing } from './design.ts';
import type { Design } from './design.ts';
import { penSegment } from './pen.ts';
import { SKETCH_PAGE_MM, addSketchLine, sketchToDesign } from './sketch.ts';
import type { SketchLine } from './sketch.ts';
import { cutList, metalBounds, prepareScene } from './scene.ts';
import { linesFromModel } from './modelBoq.ts';
import { shopDrawingSvg } from './drawing.ts';
import { imagePdf } from './pdf.ts';

const FRONT = { u: 'x', v: 'y', p: 'z' } as const;

function stages(design: Design) {
  const layout = compileDesign(design, 'בדיקה');
  const prepared = prepareScene(JSON.parse(JSON.stringify(layout))); // as saved and loaded again
  assert.deepEqual(prepared.errors, []);
  const cut = cutList(prepared.scene);
  return { layout, scene: prepared.scene, warnings: prepared.warnings, cut };
}

test('sketch → design → layout → cut list → price lines → drawing → PDF', () => {
  const reply = JSON.stringify({
    grid: { x: [1500, 1500], y: [2000], z: [] },
    members: [
      { a: [0, 0, 0], b: [0, 1, 0], profile: 'rect_tube', size: [100, 100, 4], label: 'עמוד' },
      { a: [2, 0, 0], b: [2, 1, 0], profile: 'rect_tube', size: [100, 100, 4], label: 'עמוד' },
      { a: [0, 1, 0], b: [2, 1, 0], profile: 'rect_tube', size: [60, 40, 2], label: 'משקוף' },
    ],
    blocks: [{ kind: 'gate', a: [0, 0, 0], b: [2, 0, 0], params: { posts: 0, height: 1800 } }],
    notes: ['גובה העמודים לא נכתב'],
  });
  const read = designFromReply(reply);
  assert.deepEqual(read.problems, []);
  const { layout, scene, warnings, cut } = stages(read.design);
  assert.deepEqual(warnings, []);
  assert.deepEqual(readDesign((layout as { design: unknown }).design), read.design);

  // Every member is in the cut list exactly once, and the weights add up
  assert.equal(cut.pieces.reduce((s, p) => s + p.count, 0), scene.members.length);
  const pieceKg = cut.pieces.reduce((s, p) => s + p.kg, 0) + cut.plates.reduce((s, p) => s + p.kg, 0);
  assert.ok(Math.abs(pieceKg - cut.totalKg) < 0.2);
  assert.deepEqual(
    cut.parts.map((p) => [p.kind, p.count]),
    [
      ['hinge', 2],
      ['lock', 1],
    ],
  );

  // Price lines: every section of the cut list is bought, priced where the price list has it
  const lines = linesFromModel(scene, cut, [{ id: 7, name: 'פרופיל 100/100/4', unit: 'm', unit_cost: 95, catalog_key: null }]);
  assert.ok(lines.length >= cut.sections.length);
  assert.ok(lines.some((l) => l.element_id === 7 && l.unit_cost === 95));

  // The drawing names every piece mark and the overall size
  const svg = shopDrawingSvg(scene, { cut, date: '20.11.2026' });
  for (const p of cut.pieces) assert.ok(svg.includes(`>${p.mark}<`), `mark ${p.mark}`);
  const box = metalBounds(scene);
  assert.ok(svg.includes(`>${Math.round(box.max[0] - box.min[0])}<`), 'overall width');
  assert.ok(!svg.includes('NaN'));

  // And it goes out as a PDF (the browser draws the pixels; here a stand-in image)
  const pdf = imagePdf({ width: 42, height: 30, gray: true, data: deflateSync(new Uint8Array(42 * 30).fill(255)) }, { page: 'A3', title: 'בדיקה' });
  assert.ok(new TextDecoder('latin1').decode(pdf).includes('/MediaBox [0 0 1190.55 841.89]'));
});

test('pen strokes drawn by eye become a measured frame that cuts', () => {
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [2000], z: [] } };
  const stroke = (from: { u: number; v: number }, to: { u: number; v: number }) => {
    const r = penSegment(d, FRONT, 0, from, to, 40);
    d = r.design;
    d = { ...d, members: [...d.members, { id: `p${d.members.length + 1}`, a: r.a, b: r.b, profile: 'rect_tube', size: [60, 60, 3] }] };
  };
  stroke({ u: 15, v: 10 }, { u: 5, v: 1990 }); // left post
  stroke({ u: 2990, v: -10 }, { u: 3010, v: 2005 }); // right post
  stroke({ u: 0, v: 2000 }, { u: 3000, v: 2030 }); // top rail, a little off level
  stroke({ u: 0, v: 1012 }, { u: 2995, v: 1000 }); // a middle rail where there was no grid line
  assert.deepEqual(d.grid.y, [1010, 990]);
  const { cut } = stages(d);
  assert.deepEqual(
    cut.pieces.map((p) => [p.length, p.count]),
    [
      [2940, 2], // rails between the posts' faces (longest first)
      [2030, 2], // posts from the ground to the top of the top rail
    ],
  );
});

test('blocks on a platform: the railing stands on the deck, the stairs arrive at it', () => {
  let d: Design = { ...newDesign(), grid: { x: [3000, 2500], y: [1200], z: [1500] } };
  d = addBlock(d, 'platform', [0, 1, 0], [1, 1, 1]).design;
  d = addBlock(d, 'railing', [0, 1, 1], [1, 1, 1]).design;
  d = addBlock(d, 'stairs', [2, 0, 0], [1, 1, 0]).design;
  const { scene, cut } = stages(d);
  const deck = scene.plates.find((p) => p.label === 'רצפת פח');
  const deckTop = (deck?.center[1] ?? 0) + (deck?.thickness ?? 0) / 2;
  assert.equal(deckTop, 1200);
  const posts = scene.members.filter((m) => m.label === 'עמוד מעקה');
  for (const p of posts) assert.equal(Math.round(Math.min(p.from[1], p.to[1])), 1208); // on its 8 mm plate on the deck
  const treads = scene.plates.filter((p) => p.label === 'מדרך');
  assert.equal(Math.round(Math.max(...treads.map((t) => t.center[1] + t.thickness / 2))), 1200 - Math.round(1200 / 7));
  assert.ok(cut.totalKg > 300);
});

test('a hand sketch on the pad → measured → layout → cut list → saved and read back', () => {
  let lines: SketchLine[] = [];
  const strokes: [number, number, number, number][] = [
    [40, 320, 42, 80], // post
    [44, 83, 300, 78], // top rail
    [298, 76, 301, 322], // post
    [41, 200, 299, 204], // middle rail
  ];
  for (const [x1, y1, x2, y2] of strokes) lines = addSketchLine(lines, { x: x1, y: y1 }, { x: x2, y: y2 }, 12) ?? lines;
  assert.equal(lines.length, 4);
  let design = sketchToDesign(lines, { mmPerUnit: SKETCH_PAGE_MM / 360, choice: { profile: 'rect_tube', size: [60, 60, 3] } });
  assert.equal(guessCount(design), 3);
  // The opening measured on site: everything scales with it, then the middle rail height is measured too
  design = setSpacing(design, 'x', 0, 2500);
  assert.equal(design.grid.x[0], 2500);
  design = setSpacing(design, 'y', 0, 900);
  const { cut } = stages(design);
  assert.equal(cut.pieces.reduce((n, p) => n + p.count, 0), 4);
  // Posts to the top of the top rail, both rails between the posts
  const height = design.grid.y[0] + design.grid.y[1];
  assert.deepEqual(
    cut.pieces.map((p) => [p.length, p.count]),
    [
      [2440, 2],
      [height + 30, 2],
    ],
  );
  const back = readDesign(JSON.parse(JSON.stringify(compileDesign(design, 't').design)));
  assert.deepEqual(back?.guess, { y: [false, true] });
});
