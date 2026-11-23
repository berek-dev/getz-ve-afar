import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { designFromLayout } from './fromLayout.ts';
import { compileDesign, gridLines } from './design.ts';
import { cutList, prepareScene } from './scene.ts';

// A gate as an AI writes it: posts set in concrete, rails stopping on the posts' faces, pickets on the rails' faces
const gate = {
  material: 'black',
  members: [
    { id: 'post', label: 'עמוד', profile: 'rect_tube', size: [80, 80, 3], from: [40, -500, 0], to: [40, 1800, 0], repeat: { count: 2, step: [2080, 0, 0] } },
    { id: 'rail', label: 'מסגרת', profile: 'rect_tube', size: [40, 40, 2], from: [80, 100, 0], to: [2080, 100, 0], repeat: { count: 2, step: [0, 1500, 0] } },
    { id: 'pk', label: 'מילוי', profile: 'rect_tube', size: [20, 20, 1.5], from: [600, 120, 0], to: [600, 1580, 0], repeat: { count: 3, step: [400, 0, 0] } },
  ],
  plates: [{ center: [40, 5, 0], size: [200, 200], normal: 'y', thickness: 10, label: 'פלטת בסיס' }],
  parts: [{ kind: 'hinge', at: [86, 250, 0], repeat: { count: 2, step: [0, 1000, 0] } }, { kind: 'footing', at: [40, -300, 0], size: [400, 600, 400] }],
};

test('an AI layout becomes a design: ends on faces join the centre lines, the grid is the coordinates used', () => {
  const r = designFromLayout(gate);
  assert.ok(r);
  const { design, notes } = r;
  // Posts at 0 and 2,080 (moved to start at 0), pickets at 560, 960, 1,360
  assert.deepEqual(gridLines(design.grid.x), [0, 560, 960, 1360, 2080]);
  // Ground, the rails' centre lines, the posts' tops
  assert.deepEqual(gridLines(design.grid.y), [0, 100, 1600, 1800]);
  assert.deepEqual(design.grid.z, []);
  assert.equal(design.members.length, 2 + 2 + 3);
  // A rail now runs post to post, a picket rail to rail
  const rail = design.members.find((m) => m.label === 'מסגרת');
  assert.deepEqual([rail?.a, rail?.b], [
    [0, 1, 0],
    [4, 1, 0],
  ]);
  const picket = design.members.find((m) => m.label === 'מילוי');
  assert.deepEqual([picket?.a[1], picket?.b[1]], [1, 2]);
  // The plate under the first post's foot is its base plate now
  assert.deepEqual(design.members.find((m) => m.id === 'post-1')?.base, { w: 200, d: 200, t: 10 });
  assert.equal(design.plates.length, 0);
  assert.ok(notes.some((n) => /בגובה הקרקע/.test(n)));
  assert.ok(notes.some((n) => /ציר 2/.test(n)));

  // It compiles back, and the builder's joints cut the rails between the posts as the AI had them
  const back = prepareScene(JSON.parse(JSON.stringify(compileDesign(design, 'שער'))));
  assert.deepEqual(back.errors, []);
  const cut = cutList(back.scene);
  const rails = cut.pieces.find((p) => p.name.startsWith('פרופיל 40/40/2'));
  assert.equal(rails?.length, 2000);
  assert.equal(rails?.count, 2);
});

test('evenly spaced bars between two rails become one infill', () => {
  const fence = {
    members: [
      { id: 'post', profile: 'rect_tube', size: [80, 80, 3], from: [40, 0, 0], to: [40, 1700, 0], repeat: { count: 2, step: [2080, 0, 0] } },
      { id: 'rail', profile: 'rect_tube', size: [40, 40, 2], from: [80, 100, 0], to: [2080, 100, 0], repeat: { count: 2, step: [0, 1500, 0] } },
      // Four bars spread evenly over the 2,000 between the posts: 384 clear between them and at the ends
      { id: 'bar', label: 'מילוי', profile: 'rect_tube', size: [20, 20, 1.5], from: [474, 120, 0], to: [474, 1580, 0], repeat: { count: 4, step: [404, 0, 0] } },
    ],
  };
  const r = designFromLayout(fence);
  assert.ok(r);
  const { design } = r;
  assert.equal(design.infills.length, 1);
  assert.deepEqual([design.infills[0].gap, design.infills[0].label], [384, 'מילוי']);
  assert.deepEqual(gridLines(design.grid.x), [0, 2080]);
  assert.equal(design.members.length, 4);
  const back = prepareScene(JSON.parse(JSON.stringify(compileDesign(design, 'גדר'))));
  const bars = cutList(back.scene).pieces.find((p) => p.name.startsWith('פרופיל 20/20'));
  assert.deepEqual([bars?.count, bars?.length], [4, 1460]);
});

test('the demo double gate: turned tubes keep their turn, the pickets of each leaf are one infill', () => {
  const raw = JSON.parse(readFileSync(new URL('../../seed/demo-model.json', import.meta.url), 'utf8'));
  const layout = raw.layout ?? raw;
  const r = designFromLayout(layout);
  assert.ok(r);
  assert.equal(r.design.infills.length, 2);
  assert.equal(r.design.members.length, 10);
  assert.equal(r.design.members.find((m) => m.id === 'l-bottom')?.roll, 90);
  // Every piece cuts as the AI had it, except the posts, which now start at the ground
  const name = (p: { name: string; length: number; count: number }) => `${p.name} ${p.length}/${p.count}`;
  const before = cutList(prepareScene(layout).scene).pieces.map(name);
  const after = cutList(prepareScene(JSON.parse(JSON.stringify(compileDesign(r.design, 'שער')))).scene).pieces.map(name);
  assert.deepEqual(
    before.filter((p) => !after.includes(p)),
    before.filter((p) => p.startsWith('פרופיל 80/80/3')),
  );
});

test('curved pieces, sloped sheets and what has no place in the builder', () => {
  const r = designFromLayout({
    members: [
      { id: 'arch', profile: 'rect_tube', size: [40, 40, 2], from: [0, 1000, 0], via: [500, 1300, 0], to: [1000, 1000, 0] },
      { id: 'beam', profile: 'rect_tube', size: [100, 50, 3], from: [0, 2400, 2000], to: [3000, 2400, 2000] },
    ],
    plates: [{ center: [1500, 2600, 1000], size: [3000, 2040], normal: 'y', slope: { up: '-z', deg: 11.3 }, sheet: 'pc_corrugated', tint: 'bronze' }],
    solids: [{ kind: 'concrete', center: [0, -100, 0], size: [500, 200, 500] }],
  });
  assert.ok(r);
  assert.equal(r.missed, 1);
  assert.ok(r.notes.some((n) => /מעוגל/.test(n)));
  assert.ok(r.notes.some((n) => /בטון/.test(n)));
  const plate = r.design.plates[0];
  assert.deepEqual([plate.sheet, plate.tint, plate.slope], ['pc_corrugated', 'bronze', { up: '-z', deg: 11.3 }]);
  // Laid at its low edge's level
  assert.equal(plate.a[1], plate.b[1]);
  assert.equal(designFromLayout({ members: [] }), null);
});

test('a wall in the AI model becomes a builder wall, its face towards the work', () => {
  const r = designFromLayout({
    members: [
      { id: 'rafter', profile: 'rect_tube', size: [80, 40, 2], from: [0, 2500, 0], to: [0, 2500, 3000], repeat: { count: 3, step: [2000, 0, 0] } },
      { id: 'beam', profile: 'rect_tube', size: [120, 60, 3], from: [0, 2500, 3000], to: [4000, 2500, 3000] },
      { id: 'post', profile: 'rect_tube', size: [100, 100, 3], from: [0, 0, 3000], to: [0, 2440, 3000], repeat: { count: 2, step: [4000, 0, 0] } },
    ],
    // The house: 250 thick, its face at Z = 0, longer and taller than the canopy
    solids: [{ kind: 'plaster', center: [2000, 1700, -125], size: [8000, 3400, 250] }],
  });
  assert.ok(r);
  const w = r.design.walls?.[0];
  assert.ok(w);
  assert.equal(w.thickness, 250);
  assert.equal(w.a[2], 0);
  assert.equal(w.b[2], 0);
  assert.ok(r.notes.some((n) => /הקיר מההדמיה עבר/.test(n)));
  assert.ok(!r.notes.some((n) => /בטון/.test(n)));
});

test('the design takes the material most pieces are made of, so their prices still match', () => {
  const r = designFromLayout({
    members: [
      { id: 'post', profile: 'rect_tube', size: [80, 80, 3], from: [0, 0, 0], to: [0, 2000, 0], material: 'galv', repeat: { count: 2, step: [2000, 0, 0] } },
      { id: 'rail', profile: 'rect_tube', size: [40, 40, 2], from: [40, 1000, 0], to: [1960, 1000, 0], material: 'galv' },
    ],
  });
  assert.equal(r?.design.material, 'galv');
});
