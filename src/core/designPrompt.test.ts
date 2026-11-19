import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_INSTRUCTIONS, buildDesignPrompt, designFromReply, extractJson } from './designPrompt.ts';
import { compileDesign, memberCutLengths } from './design.ts';
import { cutList, prepareScene } from './scene.ts';

const gate = {
  grid: { x: [1500, 1500], y: [2000], z: [] },
  members: [
    { a: [0, 0, 0], b: [0, 1, 0], profile: 'rect_tube', size: [100, 100, 4], label: 'עמוד', base: { w: 200, d: 200, t: 10 } },
    { a: [2, 0, 0], b: [2, 1, 0], profile: 'rect_tube', size: [100, 100, 4] },
    { a: [0, 1, 0], b: [2, 1, 0], profile: 'rect_tube', size: [60, 40, 2] },
    { a: [0, 0, 0], b: [2, 0, 0], profile: 'rect_tube', size: [60, 40, 2] },
  ],
  infills: [{ between: [3, 2], profile: 'square_bar', size: [16], gap: 100 }],
  notes: ['הגובה לא נכתב, הערכתי 2 מטר'],
};

test('the instructions list every profile and block the builder has', () => {
  for (const word of ['rect_tube', 'upn', 'stairs', 'platform', 'railing', 'ladder', 'gate', 'maxRiser', 'galv']) assert.ok(DESIGN_INSTRUCTIONS.includes(word), word);
  const prompt = buildDesignPrompt({ job: { title: 'שער כניסה', description: 'שער 3 מטר' }, note: 'הגובה 2 מטר' });
  assert.match(prompt, /Job: שער כניסה\nDescription: שער 3 מטר\nNote with the sketch: הגובה 2 מטר/);
});

test('a read sketch becomes a design that compiles, cuts and keeps its notes', () => {
  const r = designFromReply('```json\n' + JSON.stringify(gate) + '\n```');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.notes, ['הגובה לא נכתב, הערכתי 2 מטר']);
  assert.equal(r.design.members.length, 4);
  assert.equal(r.design.members[0].label, 'עמוד');
  assert.deepEqual(r.design.members[0].base, { w: 200, d: 200, t: 10 });
  assert.equal(r.design.infills.length, 1);
  const p = prepareScene(compileDesign(r.design, 'שער'));
  assert.deepEqual(p.errors, []);
  assert.ok(cutList(p.scene).pieces.some((piece) => piece.name.includes('16')));
  assert.equal(memberCutLengths(r.design).get(r.design.members[2].id), 2900); // the top rail between the posts' faces
});

test('wrong pieces are left out and listed, so the rest still opens', () => {
  const r = designFromReply(
    JSON.stringify({
      grid: { x: [3000], y: [1000, -5] },
      members: [
        { a: [0, 0, 0], b: [0, 1, 0], profile: 'rect_tube', size: [50, 50, 3] },
        { a: [0, 0, 0], b: [9, 0, 0], profile: 'rect_tube', size: [50, 50, 3] },
        { a: [1, 0, 0], b: [1, 1, 0], profile: 'wood', size: [1] },
      ],
      infills: [{ between: [0, 7] }],
      blocks: [
        { kind: 'stairs', a: [0, 0, 0], b: [1, 0, 0] },
        { kind: 'ladder', a: [1, 0, 0], b: [1, 1, 0], params: { width: 500, color: 3 } },
      ],
      material: 'gold',
    }),
  );
  assert.equal(r.design.members.length, 2);
  assert.equal(r.design.members[1].profile, 'rect_tube');
  assert.equal(r.design.blocks.length, 1);
  assert.deepEqual(r.design.blocks[0].params.width, 500);
  assert.equal(r.design.blocks[0].params.color, undefined);
  assert.equal(r.design.material, 'black');
  assert.deepEqual(r.design.grid.y, [1000]);
  assert.equal(r.problems.length, 5);
  assert.ok(r.problems.some((p) => p.startsWith('blocks[0] (stairs)')));
});

test('no JSON, or no grid, is an error', () => {
  assert.throws(() => designFromReply('I could not read the sketch'), /no_json/);
  assert.throws(() => designFromReply('{"members": []}'), /no_grid/);
  assert.deepEqual(extractJson('here: {"a": 1} done'), { a: 1 });
  assert.match(designFromReply('{"grid": {"x": [1000], "y": [1000]}}').problems[0], /no parts/);
});
