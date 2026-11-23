import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBlock, addInfill, addMember, addPlate, addWall, compileDesign, gridLines, newDesign, nodePosition } from './design.ts';
import type { Design } from './design.ts';
import { centerBetween, elementPoints, extentAlong, moveElement, rollMatters, rollMember, rotateElement, snapDelta, snapTo, stepDelta } from './move.ts';
import { cutList, prepareScene } from './scene.ts';

const rect = (...size: number[]) => ({ profile: 'rect_tube' as const, size });
const ok = (r: { design: Design } | { error: string }): Design => {
  if ('error' in r) assert.fail(r.error);
  return r.design;
};
const FRONT = { u: 'x', v: 'y' } as const;
const PLAN = { u: 'x', v: 'z' } as const;

/** Two posts 3,000 apart, 2,400 high, a beam on them */
function frame() {
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [2400], z: [] } };
  const p1 = addMember(d, [0, 0, 0], [0, 1, 0], rect(100, 100, 4));
  const p2 = addMember(p1.design, [1, 0, 0], [1, 1, 0], rect(100, 100, 4));
  const beam = addMember(p2.design, [0, 1, 0], [1, 1, 0], rect(100, 50, 3));
  d = beam.design;
  return { d, post: p1.id as string, post2: p2.id as string, beam: beam.id as string };
}

test('a piece moves by whole mm, keeps its size, and a grid line is added where it lands', () => {
  const { d, post, beam } = frame();
  const moved = ok(moveElement(d, { kind: 'member', id: post }, [1200, 0, 0]));
  assert.deepEqual(gridLines(moved.grid.x), [0, 1200, 3000]);
  const m = moved.members.find((x) => x.id === post);
  assert.deepEqual([nodePosition(moved.grid, m!.a), nodePosition(moved.grid, m!.b)], [
    [1200, 0, 0],
    [1200, 2400, 0],
  ]);
  // The other pieces stay where they were
  assert.deepEqual(elementPoints(moved, { kind: 'member', id: beam }), [
    [0, 2400, 0],
    [3000, 2400, 0],
  ]);

  // Past the end of the grid, a bay is added; before its start, the grid starts earlier
  const out = ok(moveElement(d, { kind: 'member', id: post }, [4000, 0, 0]));
  assert.deepEqual(gridLines(out.grid.x), [0, 3000, 4000]);
  const before = ok(moveElement(d, { kind: 'member', id: post }, [-500, 0, 0]));
  assert.deepEqual(gridLines(before.grid.x), [0, 500, 3500]);
  assert.deepEqual(elementPoints(before, { kind: 'member', id: post })[0], [0, 0, 0]);

  // Not below the ground
  assert.deepEqual(moveElement(d, { kind: 'member', id: post }, [0, -100, 0]), { error: 'אי אפשר לרדת מתחת לקרקע.' });
});

test('dragging snaps an end onto a grid line when it is near one; the arrows step line to line', () => {
  const { d, beam } = frame();
  const el = { kind: 'member', id: beam } as const;
  // The beam's ends are at 0 and 3,000: a drag of 2,960 brings its start near the line at 3,000
  assert.equal(snapDelta(d, el, 'x', 2960, 60), 3000);
  assert.equal(snapDelta(d, el, 'x', 1234, 60), 1230);
  assert.equal(snapDelta(d, el, 'y', -2380, 60), -2400);
  assert.equal(stepDelta(d, el, 'y', -1), -2400);
  assert.equal(stepDelta(d, el, 'y', 1), null);
  assert.equal(stepDelta(d, el, 'x', 1), 3000);
});

test('an infill moves with its two members; a block and a plate move whole', () => {
  let d: Design = { ...newDesign(), grid: { x: [2000], y: [100, 1000], z: [] } };
  const low = addMember(d, [0, 1, 0], [1, 1, 0], rect(40, 40, 2));
  const high = addMember(low.design, [0, 2, 0], [1, 2, 0], rect(40, 40, 2));
  d = addInfill(high.design, [low.id as string, high.id as string], { profile: 'square_bar', size: [12] }, 100).design;
  const fill = d.infills[0].id;
  const up = ok(moveElement(d, { kind: 'infill', id: fill }, [0, 400, 0]));
  // The lines the rails left (100 and 1,100) go with them
  assert.deepEqual(gridLines(up.grid.y), [0, 500, 1500]);
  assert.deepEqual(elementPoints(up, { kind: 'member', id: high.id as string })[0], [0, 1500, 0]);

  let s: Design = { ...newDesign(), grid: { x: [3000], y: [1200], z: [1000] } };
  s = addBlock(s, 'stairs', [0, 0, 0], [1, 1, 0]).design;
  const stairs = s.blocks[0].id;
  const along = ok(moveElement(s, { kind: 'block', id: stairs }, [0, 0, 1000]));
  assert.deepEqual(elementPoints(along, { kind: 'block', id: stairs }), [
    [0, 0, 1000],
    [3000, 1200, 1000],
  ]);
  const roof = addPlate(s, [0, 1, 0], [1, 1, 1]);
  const lifted = ok(moveElement(roof.design, { kind: 'plate', id: roof.id as string }, [0, 600, 0]));
  assert.deepEqual(gridLines(lifted.grid.y), [0, 1200, 1800]);
});

test('turning 90 degrees in a view, about the first point', () => {
  const { d, beam } = frame();
  // Clockwise on screen the 3,000 beam would go 600 into the ground, so it turns the other way, up
  const up = ok(rotateElement(d, { kind: 'member', id: beam }, FRONT));
  assert.deepEqual(elementPoints(up, { kind: 'member', id: beam }), [
    [0, 2400, 0],
    [0, 5400, 0],
  ]);
  // A post turns clockwise to lie along the ground to the right
  const { d: d2, post } = frame();
  const lying = ok(rotateElement(d2, { kind: 'member', id: post }, FRONT));
  assert.deepEqual(elementPoints(lying, { kind: 'member', id: post }), [
    [0, 0, 0],
    [2400, 0, 0],
  ]);
  assert.deepEqual(gridLines(lying.grid.x), [0, 2400, 3000]);

  // Stairs running along X turn in plan to run along Z; the depth needed is added to the grid
  let s: Design = { ...newDesign(), grid: { x: [3000], y: [1200], z: [] } };
  s = addBlock(s, 'stairs', [0, 0, 0], [1, 1, 0]).design;
  const turned = ok(rotateElement(s, { kind: 'block', id: s.blocks[0].id }, PLAN));
  assert.deepEqual(elementPoints(turned, { kind: 'block', id: s.blocks[0].id }), [
    [0, 0, 0],
    [0, 1200, 3000],
  ]);
  const layout = prepareScene(JSON.parse(JSON.stringify(compileDesign(turned, 'מדרגות'))));
  assert.deepEqual(layout.errors, []);
  assert.ok(cutList(layout.scene).pieces.length > 0);
});

test('a roof turned in plan keeps its slope pointing the turned way; stood up, it loses it', () => {
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [2400], z: [2000] } };
  const roof = addPlate(d, [0, 1, 0], [1, 1, 1], 3, 'pc_trapeze');
  d = { ...roof.design, plates: roof.design.plates.map((p) => ({ ...p, slope: { up: '-z' as const, deg: 10 } })) };
  const id = roof.id as string;
  const plan = ok(rotateElement(d, { kind: 'plate', id }, PLAN));
  // Clockwise on screen in plan (Z down the screen): rising towards -z turns to rising towards +x
  assert.deepEqual(plan.plates[0].slope, { up: '+x', deg: 10 });
  const front = ok(rotateElement(d, { kind: 'plate', id }, FRONT));
  assert.equal(front.plates[0].slope, undefined);
});

test('a member turns about its own axis: two ways for a rectangular tube, four for an angle', () => {
  const { d, beam } = frame();
  assert.equal(rollMatters('rect_tube', [100, 50, 3]), true);
  assert.equal(rollMatters('rect_tube', [80, 80, 3]), false);
  assert.equal(rollMatters('round_tube', [60, 2]), false);
  const once = rollMember(d, beam);
  assert.equal(once.members.find((m) => m.id === beam)?.roll, 90);
  assert.equal(rollMember(once, beam).members.find((m) => m.id === beam)?.roll, undefined);
  const angle = addMember(d, [0, 0, 0], [1, 0, 0], { profile: 'angle', size: [40, 40, 4] });
  let a = angle.design;
  const rolls: (number | undefined)[] = [];
  for (let i = 0; i < 4; i++) {
    a = rollMember(a, angle.id as string);
    rolls.push(a.members.find((m) => m.id === angle.id)?.roll);
  }
  assert.deepEqual(rolls, [90, 180, 270, undefined]);
  // The cut layout carries it
  const layout = compileDesign(once, 'x') as { members: { id: string; roll?: number }[] };
  assert.equal(layout.members.find((m) => m.id === beam)?.roll, 90);
});

test('a piece goes to the middle of the clear space between two others, face to face', () => {
  // Posts of different widths at 0 and 4,000, a thinner one to centre between them
  let d: Design = { ...newDesign(), grid: { x: [1000, 3000], y: [2000], z: [] } };
  const a = addMember(d, [0, 0, 0], [0, 1, 0], rect(100, 100, 3));
  const m = addMember(a.design, [1, 0, 0], [1, 1, 0], rect(80, 80, 2));
  const b = addMember(m.design, [2, 0, 0], [2, 1, 0], rect(150, 150, 4));
  d = b.design;
  const el = { kind: 'member', id: m.id as string } as const;
  const scene = () => prepareScene(JSON.parse(JSON.stringify(compileDesign(d, 'x')))).scene;
  assert.deepEqual(extentAlong(d, scene(), { kind: 'member', id: b.id as string }, 0), [3925, 4075]);
  const r = centerBetween(d, scene(), el, { kind: 'member', id: a.id as string }, { kind: 'member', id: b.id as string }, FRONT);
  if ('error' in r) assert.fail(r.error);
  // Clear space 50 to 3,925: the middle is 1,987.5 (whole mm), with 1,897.5 left each side of the 80 post
  assert.equal(r.axis, 'x');
  assert.equal(elementPoints(r.design, el)[0][0], 1988);
  assert.equal(r.gap, 1897.5);

  assert.ok('error' in centerBetween(d, scene(), el, el, { kind: 'member', id: b.id as string }, FRONT));
});

test('centring picks the axis the two stand apart on: a purlin between two beams in plan', () => {
  let d: Design = { ...newDesign(), grid: { x: [4000], y: [2400], z: [500, 2500] } };
  const front = addMember(d, [0, 1, 0], [1, 1, 0], rect(120, 60, 3));
  const back = addMember(front.design, [0, 1, 2], [1, 1, 2], rect(120, 60, 3));
  const purlin = addMember(back.design, [0, 1, 1], [1, 1, 1], rect(60, 40, 2));
  d = purlin.design;
  const scene = prepareScene(JSON.parse(JSON.stringify(compileDesign(d, 'x')))).scene;
  const r = centerBetween(d, scene, { kind: 'member', id: purlin.id as string }, { kind: 'member', id: front.id as string }, { kind: 'member', id: back.id as string }, PLAN);
  if ('error' in r) assert.fail(r.error);
  assert.equal(r.axis, 'z');
  assert.equal(elementPoints(r.design, { kind: 'member', id: purlin.id as string })[0][2], 1500);
});

const memberEl = (id: string | null) => ({ kind: 'member' as const, id: id as string });
const sceneOfDesign = (d: Design) => prepareScene(JSON.parse(JSON.stringify(compileDesign(d, 'x')))).scene;

test('snapping stretches a piece along its own line to the one it should reach, the other end staying put', () => {
  // A beam that stops 30 short of the post's centre line
  let d: Design = { ...newDesign(), grid: { x: [1970, 30], y: [2000], z: [] } };
  const post = addMember(d, [2, 0, 0], [2, 1, 0], rect(100, 100, 3));
  const beam = addMember(post.design, [0, 1, 0], [1, 1, 0], rect(80, 40, 2));
  d = beam.design;
  const r = snapTo(d, sceneOfDesign(d), memberEl(beam.id), memberEl(post.id), FRONT);
  if ('error' in r) assert.fail(r.error);
  assert.equal(r.how, 'stretch');
  assert.equal(r.mm, 30);
  assert.deepEqual(elementPoints(r.design, memberEl(beam.id)), [
    [0, 2000, 0],
    [2000, 2000, 0],
  ]);
  // Done once, it is already there
  assert.deepEqual(snapTo(r.design, sceneOfDesign(r.design), memberEl(beam.id), memberEl(post.id), FRONT), { error: 'החלק כבר צמוד.' });

  // A post 50 short of the beam above it grows up to it; its foot stays on the ground
  let p: Design = { ...newDesign(), grid: { x: [1000, 1000], y: [2350, 50], z: [] } };
  const top = addMember(p, [0, 2, 0], [2, 2, 0], rect(120, 60, 3));
  const short = addMember(top.design, [1, 0, 0], [1, 1, 0], rect(80, 80, 3));
  p = short.design;
  const grown = snapTo(p, sceneOfDesign(p), memberEl(short.id), memberEl(top.id), FRONT);
  if ('error' in grown) assert.fail(grown.error);
  assert.deepEqual(elementPoints(grown.design, memberEl(short.id)), [
    [1000, 0, 0],
    [1000, 2400, 0],
  ]);
});

test('a rafter that stops short of the wall reaches its face', () => {
  let d: Design = { ...newDesign(), grid: { x: [4000], y: [2500], z: [40, 2960] } };
  const rafter = addMember(d, [0, 1, 1], [0, 1, 2], rect(80, 40, 2));
  d = addWall(rafter.design, [0, 0, 0], [1, 1, 0]).design;
  const wall = { kind: 'wall' as const, id: (d.walls ?? [])[0].id };
  const r = snapTo(d, sceneOfDesign(d), memberEl(rafter.id), wall, { u: 'z', v: 'y' });
  if ('error' in r) assert.fail(r.error);
  assert.deepEqual([r.how, r.mm], ['stretch', 40]);
  assert.deepEqual(elementPoints(r.design, memberEl(rafter.id))[0], [0, 2500, 0]);
});

test('pieces that run side by side slide until their faces touch', () => {
  let d: Design = { ...newDesign(), grid: { x: [1000], y: [2000], z: [] } };
  const a = addMember(d, [0, 0, 0], [0, 1, 0], rect(100, 100, 3));
  const b = addMember(a.design, [1, 0, 0], [1, 1, 0], rect(100, 100, 3));
  d = b.design;
  const r = snapTo(d, sceneOfDesign(d), memberEl(b.id), memberEl(a.id), FRONT);
  if ('error' in r) assert.fail(r.error);
  assert.deepEqual([r.how, r.mm], ['move', 900]);
  assert.equal(elementPoints(r.design, memberEl(b.id))[0][0], 100);
  assert.ok('error' in snapTo(d, sceneOfDesign(d), memberEl(b.id), memberEl(b.id), FRONT));
});

test('a move takes away the grid lines it left empty, so measurements stay clean', () => {
  // A middle post at 1,200 between posts at 0 and 3,000; lines at 0, 1,200, 1,500, 3,000
  let d: Design = { ...newDesign(), grid: { x: [1200, 300, 1500], y: [2400], z: [] } };
  const left = addMember(d, [0, 0, 0], [0, 1, 0], rect(100, 100, 3));
  const mid = addMember(left.design, [1, 0, 0], [1, 1, 0], rect(100, 100, 3));
  const right = addMember(mid.design, [3, 0, 0], [3, 1, 0], rect(100, 100, 3));
  d = right.design;
  const el = { kind: 'member' as const, id: mid.id as string };
  // Dragged by eye to 840: 1,200 is left empty and goes; 840 is new
  const dragged = ok(moveElement(d, el, [-360, 0, 0]));
  assert.deepEqual(gridLines(dragged.grid.x), [0, 840, 1500, 3000]);
  // Centred: 840 goes too, and the measured 1,500 and 1,500 are back
  const scene = prepareScene(JSON.parse(JSON.stringify(compileDesign(dragged, 'x')))).scene;
  const r = centerBetween(dragged, scene, el, { kind: 'member', id: left.id as string }, { kind: 'member', id: right.id as string }, FRONT);
  if ('error' in r) assert.fail(r.error);
  assert.deepEqual(r.design.grid.x, [1500, 1500]);
  assert.equal(r.design.guess, undefined);
});
