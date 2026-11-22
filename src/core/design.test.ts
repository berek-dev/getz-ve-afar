import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBay, addBlock, addInfill, addPlate, addMember, allGuessed, allGuesses, compileDesign, elementOf, fitSlope, guessCount, guesses, insertGridLine, memberCutLengths, newDesign, parseSize, plateError, plateReport, readDesign, removeLastBay, setSpacing, sizeFromFields, updateMember, updatePlate, addWall, removeWall } from './design.ts';
import type { Design } from './design.ts';
import { cutList, plateCorners, prepareScene } from './scene.ts';

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
  // From the bottom rail's top face (the rail sits on the ground) to the top rail's underside
  assert.equal(Math.round(bars[0].from[1]), 100);
  assert.equal(Math.round(bars[0].to[1]), 950);
});

test('a rail on the ground level sits on the ground, and the posts do not run below it', () => {
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [2000], z: [] } };
  const c1 = addMember(d, [0, 0, 0], [0, 1, 0], col);
  d = addMember(c1.design, [1, 0, 0], [1, 1, 0], col).design;
  d = addMember(d, [0, 1, 0], [1, 1, 0], beam).design;
  const rail = addMember(d, [0, 0, 0], [1, 0, 0], beam);
  const p = prepareScene(compileDesign(rail.design, 'שער'));
  assert.deepEqual(p.errors, []);
  const lowest = Math.min(...p.scene.members.flatMap((m) => [m.from[1], m.to[1]]));
  assert.equal(lowest, 0);
  const r = p.scene.members.find((m) => m.id === rail.id);
  assert.equal(r?.from[1], 50); // a 100-high rail: its center 50 above the ground
  assert.equal(memberCutLengths(rail.design).get(c1.id as string), 2050); // from the ground to the top of the beam
});

test('a post standing on a sill on the ground starts on the sill', () => {
  let d: Design = { ...newDesign(), grid: { x: [1500, 1500], y: [1000], z: [] } };
  d = addMember(d, [0, 0, 0], [2, 0, 0], beam).design;
  const post = addMember(d, [1, 0, 0], [1, 1, 0], col);
  const m = prepareScene(compileDesign(post.design, 'x')).scene.members.find((x) => x.id === post.id);
  assert.equal(Math.min(m?.from[1] ?? -1, m?.to[1] ?? -1), 100);
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

test('spacings drawn by eye are guesses until measured; the first measurement scales the whole sketch', () => {
  let d: Design = allGuesses({ ...newDesign(), grid: { x: [1500, 1000], y: [1000], z: [] } });
  assert.equal(guessCount(d), 3);
  assert.ok(allGuessed(d));
  // The width measured at 3,000 where the sketch said 1,500: everything doubles
  d = setSpacing(d, 'x', 0, 3000);
  assert.deepEqual(d.grid, { x: [3000, 2000], y: [2000], z: [] });
  assert.deepEqual(guesses(d, 'x'), [false, true]);
  assert.equal(allGuessed(d), false);
  // Later measurements change only their own bay
  d = setSpacing(d, 'y', 0, 1850);
  assert.deepEqual(d.grid, { x: [3000, 2000], y: [1850], z: [] });
  // Typing the value it already shows confirms a guess
  d = setSpacing(d, 'x', 1, 2000);
  assert.equal(guessCount(d), 0);
  assert.equal(d.guess, undefined, 'nothing left to mark');
});

test('a measured design never rescales; lines added by drawing are guesses, bays added by hand are not', () => {
  let d = newDesign();
  d = setSpacing(d, 'x', 0, 2500);
  assert.deepEqual(d.grid.y, [2000]);
  const split = insertGridLine(d, 'y', 900);
  assert.deepEqual(split.design.grid.y, [900, 1100]);
  assert.deepEqual(guesses(split.design, 'y'), [true, true]);
  const past = insertGridLine(split.design, 'x', 3000);
  assert.deepEqual(guesses(past.design, 'x'), [false, true]);
  const before = insertGridLine(past.design, 'x', -400);
  assert.deepEqual(before.design.grid.x, [400, 2500, 500]);
  assert.deepEqual(guesses(before.design, 'x'), [true, false, true]);
  const more = addBay(before.design, 'x');
  assert.deepEqual(guesses(more, 'x'), [true, false, true, false]);
  const fewer = removeLastBay(more, 'x').design;
  assert.deepEqual(guesses(fewer, 'x'), [true, false, true]);
  // One measured bay is enough: the next measurement changes only its own
  const measured = setSpacing(fewer, 'x', 0, 300);
  assert.deepEqual(measured.grid.x, [300, 2500, 500]);
});

test('guesses travel with a saved design; flags that do not match the grid are dropped', () => {
  const d = allGuesses({ ...newDesign(), grid: { x: [1200, 800], y: [1000], z: [] } });
  const back = readDesign(JSON.parse(JSON.stringify(compileDesign(d, 't').design)));
  assert.deepEqual(back?.guess, { x: [true, true], y: [true] });
  const odd = readDesign({ ...d, guess: { x: [true], y: ['yes'] } });
  assert.equal(odd?.guess, undefined);
  assert.equal(readDesign(newDesign())?.guess, undefined);
});

test('a size typed one number per field: no "/" needed, a comma is a decimal point', () => {
  assert.deepEqual(sizeFromFields('flat', ['50', '8']), [50, 8]);
  assert.deepEqual(sizeFromFields('rect_tube', ['60', '40', '2']), [60, 40, 2]);
  assert.deepEqual(sizeFromFields('rect_tube', ['50', '', '3']), [50, 50, 3], 'square when the depth stays empty');
  assert.deepEqual(sizeFromFields('angle', ['40', ' ', '4']), [40, 40, 4]);
  assert.deepEqual(sizeFromFields('round_tube', ['48,3', '2.9']), [48.3, 2.9]);
  assert.deepEqual(sizeFromFields('ipe', ['200']), [200]);
  assert.equal(sizeFromFields('ipe', ['210']), null, 'not a standard beam');
  assert.equal(sizeFromFields('flat', ['50', '']), null);
  assert.equal(sizeFromFields('flat', ['50/8', '']), null);
  assert.equal(sizeFromFields('flat', ['-5', '8']), null);
});

/** A 2,000/1,500 frame of 60/60/3: two posts, a top beam and a rail lying on the ground */
function frame2000(): Design {
  const sq = { profile: 'rect_tube' as const, size: [60, 60, 3] };
  let d: Design = { ...newDesign(), grid: { x: [2000], y: [1500], z: [] } };
  for (const [a, b] of [
    [[0, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0]],
    [[0, 1, 0], [1, 1, 0]],
    [[0, 0, 0], [1, 0, 0]],
  ] as [Design['members'][number]['a'], Design['members'][number]['a']][])
    d = addMember(d, a, b, sq).design;
  return d;
}
const platesOf = (d: Design) => (compileDesign(d, 't').plates as { id: string; center: number[]; size: number[]; normal: string; thickness: number }[]).filter((p) => p.id.startsWith('p'));

test('a plate on a frame covers its outside and sits on its face; inside, it fits between the pieces', () => {
  const placed = addPlate(frame2000(), [0, 0, 0], [1, 1, 0], 3);
  assert.ok(placed.id);
  const plate = placed.design.plates[0];
  assert.equal(plate.fit, 'face', 'there is a frame around it');
  // Outside of the posts and the top beam; the bottom rail sits on the ground, so the plate starts at the ground
  assert.deepEqual(platesOf(placed.design)[0], { id: plate.id, center: [1000, 765, 31.5], size: [2060, 1530], normal: 'z', thickness: 3, label: 'פח' });
  const back = updatePlate(placed.design, plate.id, { side: -1 });
  assert.equal(platesOf(back)[0].center[2], -31.5);
  // Inside: between the posts, from the top of the rail to the underside of the beam
  const inside = updatePlate(placed.design, plate.id, { fit: 'inside' });
  assert.deepEqual(platesOf(inside)[0].size, [1940, 1410]);
  assert.deepEqual(platesOf(inside)[0].center, [1000, 765, 0]);
});

test('a plate on its own stays on the grid lines; one on the ground lies on it; a floor sits on its beams', () => {
  const alone = addPlate({ ...newDesign(), grid: { x: [1200], y: [800], z: [600] } }, [0, 0, 0], [1, 0, 1], 4);
  assert.equal(alone.design.plates[0].fit, 'center');
  assert.deepEqual(platesOf(alone.design)[0], { id: alone.id, center: [600, 2, 300], size: [1200, 600], normal: 'y', thickness: 4, label: 'פח' });
  // A floor on four beams at 1,000
  const sq = { profile: 'rect_tube' as const, size: [60, 60, 3] };
  let d: Design = { ...newDesign(), grid: { x: [2000], y: [1000], z: [1000] } };
  for (const [a, b] of [
    [[0, 1, 0], [1, 1, 0]],
    [[0, 1, 1], [1, 1, 1]],
    [[0, 1, 0], [0, 1, 1]],
    [[1, 1, 0], [1, 1, 1]],
  ] as [Design['members'][number]['a'], Design['members'][number]['a']][])
    d = addMember(d, a, b, sq).design;
  const floor = addPlate(d, [0, 1, 0], [1, 1, 1], 3);
  assert.deepEqual(platesOf(floor.design)[0].center, [1000, 1031.5, 500]);
  assert.deepEqual(platesOf(floor.design)[0].size, [2060, 1060]);
  // Its weight comes through to the cut list: 2.06 x 1.06 m of 3 mm steel
  const cut = cutList(prepareScene(JSON.parse(JSON.stringify(compileDesign(floor.design, 't')))).scene);
  assert.equal(cut.plates.length, 1);
  assert.ok(Math.abs(cut.plates[0].kg - 2.06 * 1.06 * 3 * 7.85) < 1);
});

test('plates need two opposite corners; they move with the grid, go with the last bay, and read back', () => {
  assert.match(plateError([0, 0, 0], [1, 0, 0]) ?? '', /לא על אותו קו/);
  assert.match(plateError([0, 0, 0], [1, 1, 1]) ?? '', /באותו מבט/);
  assert.equal(addPlate(newDesign(), [0, 0, 0], [0, 0, 0]).id, null);
  const d = addPlate(frame2000(), [0, 0, 0], [1, 1, 0]).design;
  const split = insertGridLine(d, 'x', 500).design;
  assert.deepEqual([split.plates[0].a, split.plates[0].b], [[0, 0, 0], [2, 1, 0]]);
  const { design: fewer, removed } = removeLastBay(split, 'x');
  assert.equal(fewer.plates.length, 0);
  assert.ok(removed >= 1);
  const back = readDesign(JSON.parse(JSON.stringify(compileDesign(d, 't').design)));
  assert.deepEqual(back?.plates, d.plates);
  assert.deepEqual(readDesign({ ...d, plates: [{ id: 'x', a: [0, 0, 0], b: [1, 0, 0], thickness: 3 }, { id: 'y', a: [0, 0, 0], b: [1, 1, 0] }] })?.plates, []);
});

test('a piece picked in 3D leads back to what the design holds: member, base plate, infill bars, plate, block', () => {
  let d = frame2000();
  const post = d.members[0].id;
  d = updateMember(d, post, { base: { w: 200, d: 200, t: 10 } });
  d = addInfill(d, [d.members[2].id, d.members[3].id], { profile: 'square_bar', size: [16] }, 100).design;
  const fill = d.infills[0].id;
  d = addPlate(d, [0, 0, 0], [1, 1, 0]).design;
  const plate = d.plates[0].id;
  const layout = compileDesign(d, 't') as { members: { id: string }[]; plates: { id: string }[] };
  const ids = [...layout.members.map((m) => m.id), ...layout.plates.map((p) => p.id)];
  assert.ok(ids.includes(`${post}-base`) && ids.includes(fill) && ids.includes(plate));
  assert.deepEqual(elementOf(d, post), { kind: 'member', id: post });
  assert.deepEqual(elementOf(d, `${post}-base`), { kind: 'member', id: post });
  assert.deepEqual(elementOf(d, fill), { kind: 'infill', id: fill });
  assert.deepEqual(elementOf(d, plate), { kind: 'plate', id: plate });
  const deep = addBlock({ ...d, grid: { ...d.grid, z: [800] } }, 'tank', [0, 0, 0], [1, 0, 1]);
  assert.deepEqual(elementOf(deep.design, `${deep.id}/front`), { kind: 'block', id: deep.id });
  assert.equal(elementOf(d, 'b9/front'), null);
  assert.equal(elementOf(d, 'nothing'), null);
});

test('roofing sheets (סנטף) as plates: placed like one, drawn see-through, weighed per m², checked against purlins', () => {
  const sq = { profile: 'rect_tube' as const, size: [100, 50, 3] };
  // A pergola top 3,000 by 2,400 at 2,500: four beams round it
  let d: Design = { ...newDesign(), grid: { x: [900, 1200, 900], y: [2500], z: [2400] } };
  for (const [a, b] of [
    [[0, 1, 0], [3, 1, 0]],
    [[0, 1, 1], [3, 1, 1]],
    [[0, 1, 0], [0, 1, 1]],
    [[3, 1, 0], [3, 1, 1]],
  ] as [Design['members'][number]['a'], Design['members'][number]['a']][])
    d = addMember(d, a, b, sq).design;
  const placed = addPlate(d, [0, 1, 0], [3, 1, 1], 3, 'pc_trapeze');
  assert.ok(placed.id);
  const layout = JSON.parse(JSON.stringify(compileDesign(placed.design, 'פרגולה')));
  const plate = layout.plates[0];
  assert.deepEqual([plate.sheet, plate.tint, plate.thickness, plate.label], ['pc_trapeze', 'clear', 16, 'סנטף מלבני']);
  // On top of the beams (100 high, laid upright), the 16 mm wave
  assert.equal(plate.center[1], 2500 + 50 + 8);
  const { scene } = prepareScene(layout);
  assert.ok((scene.plates[0].opacity ?? 1) < 1);
  const cut = cutList(scene);
  assert.equal(cut.plates[0].sheet, 'pc_trapeze');
  assert.match(cut.plates[0].name, /^סנטף מלבני .*, שקוף$/);
  assert.ok(Math.abs(cut.plates[0].kg - cut.plates[0].areaM2 * 1.1) < 0.2);
  // The steel weight leaves the sheets out
  assert.equal(cut.totalKg, Math.round(cut.pieces.reduce((s, p) => s + p.kg, 0) * 10) / 10);

  // Beams only round the edge: 2,400 and 3,000 open, more than the 900 a trapeze sheet takes at its ends
  const id = placed.id as string;
  const bare = plateReport(placed.design, id);
  assert.match(bare.warn ?? '', /כדאי להוסיף מרישים/);
  assert.ok(bare.info.some((l) => /לוחות ברוחב 1,260/.test(l)));
  // Purlins across at every grid line (900, 1,200, 900 apart): enough one way
  let withPurlins = placed.design;
  for (const x of [1, 2] as const) withPurlins = addMember(withPurlins, [x, 1, 0], [x, 1, 1], sq).design;
  assert.equal(plateReport(withPurlins, id).warn, null);

  // Reads back, tint and all; a sheet needs no thickness; turning it to steel drops it
  const tinted = updatePlate(withPurlins, id, { tint: 'bronze' });
  const back = readDesign(JSON.parse(JSON.stringify(tinted)));
  assert.deepEqual([back?.plates[0].sheet, back?.plates[0].tint], ['pc_trapeze', 'bronze']);
  const noThickness = readDesign(JSON.parse(JSON.stringify({ ...tinted, plates: [{ ...tinted.plates[0], thickness: undefined }] })));
  assert.equal(noThickness?.plates.length, 1);
  const steel = updatePlate(tinted, id, { sheet: undefined, tint: undefined });
  const steelPlate = JSON.parse(JSON.stringify(compileDesign(steel, 't'))).plates[0];
  assert.deepEqual([steelPlate.sheet, steelPlate.thickness, steelPlate.label], [undefined, 3, 'פח']);
});

test('a sloped roof lies on its rafters: found by itself when placed, kept when read back, tilted in the layout', () => {
  const sq = { profile: 'rect_tube' as const, size: [100, 50, 3] };
  // A lean-to: the front beam at 2,400 (+Z, toward the street), the back one against the house at 2,800, rafters between
  let d: Design = { ...newDesign(), grid: { x: [3000], y: [2400, 400], z: [2000] } };
  for (const [a, b] of [
    [[0, 1, 1], [1, 1, 1]],
    [[0, 2, 0], [1, 2, 0]],
    [[0, 1, 1], [0, 2, 0]],
    [[1, 1, 1], [1, 2, 0]],
  ] as [Design['members'][number]['a'], Design['members'][number]['a']][])
    d = addMember(d, a, b, sq).design;
  // Placed in plan at the front beam's level: it rises 400 over 2,000 toward the back
  const low = addPlate(d, [0, 1, 0], [1, 1, 1], 3, 'pc_corrugated');
  const plate = low.design.plates[0];
  assert.deepEqual(plate.slope, { up: '-z', deg: 11.3 });
  const layoutPlate = JSON.parse(JSON.stringify(compileDesign(low.design, 't'))).plates[0];
  assert.deepEqual(layoutPlate.slope, { up: '-z', deg: 11.3 });
  // Its true length runs down the slope, past the beams on both edges
  assert.equal(layoutPlate.size[0], 3050);
  assert.ok(Math.abs(layoutPlate.size[1] - 2050 / Math.cos((11.3 * Math.PI) / 180)) < 0.5);
  const { scene } = prepareScene(layoutPlate ? { plates: [layoutPlate] } : {});
  const corners = plateCorners(scene.plates[0]);
  const ys = corners.map((c) => c[1]);
  // The back edge (−Z) is the high one, 2,050 × tan 11.3° ≈ 410 higher
  const back = corners.filter((c) => c[2] < 1000).map((c) => c[1]);
  const front = corners.filter((c) => c[2] > 1000).map((c) => c[1]);
  assert.ok(Math.abs(back[0] - front[0] - 2050 * Math.tan((11.3 * Math.PI) / 180)) < 1);
  assert.ok(Math.min(...ys) > 2400 && Math.max(...ys) > 2800);

  // Placed on the high level instead: it moves down to the low one and rises back
  const high = addPlate(d, [0, 2, 0], [1, 2, 1], 3);
  assert.deepEqual([high.design.plates[0].a[1], high.design.plates[0].slope], [1, { up: '-z', deg: 11.3 }]);
  // Without rafters nothing slopes by itself; the beam on the far edge still sets it on request
  const beamsOnly = { ...d, members: d.members.slice(0, 2) };
  const flat = addPlate(beamsOnly, [0, 1, 0], [1, 1, 1], 3);
  assert.equal(flat.design.plates[0].slope, undefined);
  const fitted = fitSlope(flat.design, flat.id as string);
  assert.deepEqual(fitted?.plates[0].slope, { up: '-z', deg: 11.3 });
  assert.equal(fitSlope(beamsOnly, 'nope'), null);
  // Any angle can be typed; it reads back; a slope on a wall is dropped
  const typed = updatePlate(low.design, low.id as string, { slope: { up: '-z', deg: 15 } });
  assert.deepEqual(readDesign(JSON.parse(JSON.stringify(typed)))?.plates[0].slope, { up: '-z', deg: 15 });
  const wall = { ...typed, plates: [{ ...typed.plates[0], a: [0, 0, 0], b: [1, 1, 0] }] };
  assert.equal(readDesign(JSON.parse(JSON.stringify(wall)))?.plates[0].slope, undefined);
  // The sheet's span is measured down the slope: rafters only at the edges, 2,090 apart, too far for corrugated
  assert.match(plateReport(low.design, low.id as string).warn ?? '', /מרישים/);
});

test('an existing wall: drawn as a solid behind its face, away from the work, never cut or priced', () => {
  let d: Design = { ...newDesign(), grid: { x: [4000], y: [2500], z: [3000] } };
  d = addMember(d, [0, 1, 0], [0, 1, 1], { profile: 'rect_tube', size: [80, 40, 2] }).design;
  assert.equal(addWall(d, [0, 0, 0], [1, 0, 0]).id, null);
  assert.equal(addWall(d, [0, 0, 0], [1, 1, 1]).id, null);
  const w = addWall(d, [0, 0, 0], [1, 1, 0]);
  assert.ok(w.id);
  const layout = compileDesign(w.design, 'גגון') as { solids?: { center: number[]; size: number[]; kind: string }[] };
  // The work is towards +Z, so the wall's 200 go back to -Z from its face on Z = 0
  assert.deepEqual(layout.solids, [{ kind: 'plaster', center: [2000, 1250, -100], size: [4000, 2500, 200], label: 'קיר קיים' }]);
  // Read back, kept through a new grid line, and gone with its line
  assert.deepEqual(readDesign(JSON.parse(JSON.stringify(w.design)))?.walls, w.design.walls);
  const wider = insertGridLine(w.design, 'z', -500).design;
  assert.deepEqual(wider.walls?.[0].a, [0, 0, 1]);
  assert.equal(removeWall(w.design, w.id as string).walls, undefined);
  // Not in the cut list
  const cut = cutList(prepareScene(JSON.parse(JSON.stringify(layout))).scene);
  assert.equal(cut.pieces.length, 1);
});
