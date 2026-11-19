import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBlock, addMember, blockReport, compileDesign, newDesign, readDesign, removeLastBay, updateBlock } from './design.ts';
import type { Design } from './design.ts';
import { placementError } from './blocks.ts';
import type { BlockKind } from './blocks.ts';
import { cutList, prepareScene } from './scene.ts';
import type { DesignNode } from './design.ts';

function place(d: Design, kind: BlockKind, a: DesignNode, b: DesignNode, set: Record<string, number> = {}) {
  const r = addBlock(d, kind, a, b, set);
  assert.ok(r.id, `${kind} placed`);
  return { d: r.design, id: r.id as string };
}
function scene(d: Design) {
  const p = prepareScene(compileDesign(d, 'בדיקה'));
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  return p.scene;
}
const top = (m: { from: number[]; to: number[] }) => Math.max(m.from[1], m.to[1]);
const bottom = (m: { from: number[]; to: number[] }) => Math.min(m.from[1], m.to[1]);

test('stairs: risers no higher than asked, a tread per riser but the last, nothing below the floor', () => {
  const { d, id } = place({ ...newDesign(), grid: { x: [4000], y: [3000], z: [] } }, 'stairs', [0, 0, 0], [1, 1, 0]);
  const s = scene(d);
  const treads = s.plates.filter((p) => p.label === 'מדרך');
  assert.equal(treads.length, 16); // 17 risers of 176
  assert.equal(Math.round(treads[0].center[1] + treads[0].thickness / 2), 176);
  assert.equal(Math.round(treads[15].center[1] + treads[15].thickness / 2), 2824);
  const stringers = s.members.filter((m) => m.label === 'לחי מדרגות');
  assert.equal(stringers.length, 2);
  for (const m of s.members) assert.ok(bottom(m) >= 0, `${m.id} below the floor`);
  const report = blockReport(d, id);
  assert.equal(report.warn, null);
  assert.match(report.info[0], /17 רומים של 176/);
  assert.ok(s.notes?.some((n) => n.includes('שלח 250')));
});

test('stairs that are too steep say so, with the run they need', () => {
  const { d, id } = place({ ...newDesign(), grid: { x: [2000], y: [3000], z: [] } }, 'stairs', [0, 0, 0], [1, 1, 0]);
  assert.match(blockReport(d, id).warn ?? '', /תלול/);
});

test('a platform: deck at the level, posts to the ground under the beams, joists between them', () => {
  const { d } = place({ ...newDesign(), grid: { x: [3000], y: [1200], z: [2000] } }, 'platform', [0, 1, 0], [1, 1, 1]);
  const s = scene(d);
  const posts = s.members.filter((m) => m.label === 'עמוד במה');
  assert.equal(posts.length, 4);
  for (const p of posts) assert.equal(Math.round(top(p)), 1195); // up to the beams' top, under a 5 mm deck
  assert.equal(s.plates.filter((p) => p.label === 'פלטת בסיס').length, 4);
  assert.equal(s.members.filter((m) => m.label === 'קורת משנה').length, 4);
  const deck = s.plates.find((p) => p.label === 'רצפת פח');
  assert.equal(deck?.center[1], 1197.5);
  const edges = s.members.filter((m) => m.label === 'קורה היקפית');
  assert.equal(edges.length, 4);
  for (const e of edges) assert.equal(Math.round(top(e) + 80), 1195); // UPN 160 centered 80 below its top
});

test('a railing on a beam stands on it; on bare ground its posts get base plates', () => {
  const beam = { profile: 'rect_tube' as const, size: [100, 50, 3] };
  const withBeam = addMember({ ...newDesign(), grid: { x: [3000], y: [1000], z: [] } }, [0, 1, 0], [1, 1, 0], beam).design;
  const { d } = place(withBeam, 'railing', [0, 1, 0], [1, 1, 0]);
  const s = scene(d);
  const posts = s.members.filter((m) => m.label === 'עמוד מעקה');
  assert.equal(posts.length, 3);
  const middle = posts.find((m) => Math.abs(m.from[0] - 1500) < 1);
  assert.equal(Math.round(bottom(middle as (typeof posts)[number])), 1050); // on the beam's top face
  const rail = s.members.find((m) => m.label === 'מאחז');
  assert.equal(Math.round(top(rail as (typeof posts)[number]) + 25), 2100); // 1,050 above the beam's top
  assert.equal(s.plates.length, 0);
  const bars = s.members.filter((m) => m.label === 'מוט מילוי');
  assert.ok(bars.length > 20);

  const bare = place({ ...newDesign(), grid: { x: [3000], y: [1000], z: [] } }, 'railing', [0, 0, 0], [1, 0, 0]);
  assert.equal(scene(bare.d).plates.filter((p) => p.label === 'פלטת בסיס').length, 3);
});

test('a ladder: rungs up to the top point, rails on past it, a cage when asked', () => {
  const g = { ...newDesign(), grid: { x: [2000], y: [3000], z: [] } };
  const { d, id } = place(g, 'ladder', [0, 0, 0], [0, 1, 0]);
  const s = scene(d);
  const rungs = s.members.filter((m) => m.label === 'שלב');
  assert.equal(rungs.length, 11);
  assert.equal(Math.round(Math.max(...rungs.map((m) => m.from[1]))), 3000);
  const rails = s.members.filter((m) => m.label === 'צד סולם');
  assert.equal(rails.length, 2);
  assert.equal(Math.round(top(rails[0])), 4050);
  assert.equal(rails[0].roll, 90); // the thin side faces the rungs
  const caged = scene(updateBlock(d, id, { params: { cage: 1 } }));
  assert.equal(caged.members.filter((m) => m.label === 'חישוק').length, 3);
  assert.ok(cutList(caged).pieces.some((p) => p.bent));
});

test('a gate: leaves fill the opening less the clearances, with hinges and a lock', () => {
  const { d, id } = place({ ...newDesign(), grid: { x: [3000], y: [2000], z: [] } }, 'gate', [0, 0, 0], [1, 0, 0]);
  const s = scene(d);
  const stiles = s.members.filter((m) => m.id.includes('-stile'));
  assert.equal(stiles.length, 2);
  const outer = Math.max(...stiles.map((m) => m.from[0])) - Math.min(...stiles.map((m) => m.from[0])) + 60;
  assert.equal(Math.round(outer), 2880); // 3,000 less two posts of 100 less 10 each side
  const cut = cutList(s);
  assert.deepEqual(
    cut.parts.map((p) => [p.kind, p.count]),
    [
      ['hinge', 2],
      ['lock', 1],
    ],
  );
  assert.match(blockReport(d, id).info[0], /פתח נקי 2,900/);
  const two = scene(updateBlock(d, id, { params: { leaves: 2 } }));
  assert.equal(two.members.filter((m) => m.id.includes('-stile')).length, 4);
});

test('a gate between posts already drawn measures from their faces', () => {
  const col = { profile: 'rect_tube' as const, size: [100, 100, 4] };
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [2100], z: [] } };
  d = addMember(d, [0, 0, 0], [0, 1, 0], col).design;
  d = addMember(d, [1, 0, 0], [1, 1, 0], col).design;
  const g = place(d, 'gate', [0, 0, 0], [1, 0, 0], { posts: 0 });
  assert.match(blockReport(g.d, g.id).info[0], /פתח נקי 2,900/);
});

test('blocks only go where they fit', () => {
  assert.equal(placementError('stairs', [0, 0, 0], [1, 1, 0]), null);
  assert.ok(placementError('stairs', [0, 0, 0], [1, 0, 0]));
  assert.ok(placementError('stairs', [0, 0, 0], [1, 1, 1]));
  assert.ok(placementError('ladder', [0, 0, 0], [1, 1, 0]));
  assert.ok(placementError('railing', [0, 0, 0], [1, 1, 0]));
  assert.ok(placementError('platform', [0, 0, 0], [1, 0, 1])); // on the ground
  assert.equal(placementError('platform', [0, 1, 0], [1, 1, 1]), null);
});

test('blocks are saved with the design and go with the last bay', () => {
  const { d } = place({ ...newDesign(), grid: { x: [3000, 1000], y: [1000], z: [] } }, 'railing', [1, 1, 0], [2, 1, 0]);
  const layout = compileDesign(d, 'x') as { design: unknown };
  assert.deepEqual(readDesign(JSON.parse(JSON.stringify(layout.design))), d);
  const junk = readDesign({ ...d, blocks: [{ id: 'b9', kind: 'rocket', a: [0, 0, 0], b: [1, 0, 0] }] });
  assert.equal(junk?.blocks.length, 0);
  const { design, removed } = removeLastBay(d, 'x');
  assert.equal(removed, 1);
  assert.equal(design.blocks.length, 0);
});
