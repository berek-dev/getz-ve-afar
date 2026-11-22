import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addMember, addPlate, compileDesign, newDesign } from './design.ts';
import type { Design, ProfileChoice } from './design.ts';
import { prepareScene } from './scene.ts';
import type { ResolvedScene } from './scene.ts';
import { checkStrength } from './strength.ts';

const rect = (...size: number[]): ProfileChoice => ({ profile: 'rect_tube', size });
const sceneOf = (d: Design): ResolvedScene => {
  const p = prepareScene(JSON.parse(JSON.stringify(compileDesign(d, 'בדיקה'))));
  assert.deepEqual(p.errors, []);
  return p.scene;
};

/** 4,000 by 3,000, posts 2,500 high, two beams along X, purlins along Z every 1,000, a סנטף roof on them */
function pergola(purlin = rect(60, 40, 2), bays = [1000, 1000, 1000, 1000]): Design {
  let d: Design = { ...newDesign(), grid: { x: bays, y: [2500], z: [3000] } };
  const last = bays.length;
  for (const x of [0, last]) for (const z of [0, 1]) d = addMember(d, [x, 0, z], [x, 1, z], rect(100, 100, 3)).design;
  for (const z of [0, 1]) d = addMember(d, [0, 1, z], [last, 1, z], rect(120, 60, 3)).design;
  for (let x = 0; x <= last; x++) d = addMember(d, [x, 1, 0], [x, 1, 1], purlin).design;
  return addPlate(d, [0, 1, 0], [last, 1, 1], 3, 'pc_trapeze').design;
}

test('a pergola: purlins sag about as a beam between its two beams, the wind lifts each post by its share', () => {
  const r = checkStrength(sceneOf(pergola()));
  assert.equal(r.status, 'ok');
  assert.deepEqual([r.loose, r.unsupported], [[], []]);
  assert.equal(r.supports.length, 4);
  assert.ok(Math.abs(r.steelKg - 200) < 5, String(r.steelKg));

  // A purlin carries 1,000 of roof: 0.4 kN/m², own weight and the sheet's. Welded at both ends it sags less than a
  // simple beam (5qL⁴/384EI, 11 mm) and more than a fully fixed one (qL⁴/384EI)
  const sag = r.sag;
  assert.ok(sag && sag.mm > 2.3 && sag.mm < 11.5, JSON.stringify(sag));
  assert.equal(Math.round(sag.limit), 15);

  // Lifted by 1.5 × 0.8 kN/m² over the roof, held down by its own weight: a quarter on each post
  const roof = r.roofArea / 1e6;
  const own = (r.steelKg + 1.1 * roof) * 9.81 / 1000;
  const up = (1.5 * 0.8 * roof - own) / 4;
  for (const s of r.supports) assert.ok(Math.abs(s.up - up) / up < 0.15, `${s.up} vs ${up}`);
});

test('purlins too weak for their span fail, with a size that holds', () => {
  // Three bays of 2,000: purlins 30/20/1.5 carry 2,000 of roof each over 3,000
  const r = checkStrength(sceneOf(pergola(rect(30, 20, 1.5), [2000, 2000, 2000])));
  assert.equal(r.status, 'fail');
  const weak = r.members.filter((m) => m.verdict === 'fail');
  assert.ok(weak.length >= 2);
  assert.ok(weak.every((m) => m.name.includes('30/20')));
  const s = weak[0].suggest;
  assert.ok(s && s.util <= 0.9 && !s.name.includes('30/20'), JSON.stringify(s));
  assert.equal(r.verdicts[weak[0].id], 'fail');
});

test('a post alone in the wind: its base holds the textbook moment', () => {
  const d = addMember({ ...newDesign(), grid: { x: [1000], y: [2500], z: [] } }, [0, 0, 0], [0, 1, 0], rect(100, 100, 3)).design;
  const r = checkStrength(sceneOf(d));
  assert.equal(r.supports.length, 1);
  // 1.5 × 0.8 kN/m² × 2.0 × 100 mm = 0.24 kN/m over 2,500: wL²/2 = 0.75 kN·m, 0.6 kN sideways
  assert.ok(Math.abs(r.supports[0].moment - 0.75) < 0.02, String(r.supports[0].moment));
  assert.ok(Math.abs(r.supports[0].shear - 0.6) < 0.02, String(r.supports[0].shear));

  // On a hinge it falls over
  const hinged = checkStrength(sceneOf(d), { roofLoad: 0.4, wind: 0.8, base: 'pinned' });
  assert.equal(hinged.status, 'unstable');
  assert.ok(hinged.unstableAt);
});

test('a piece joined to nothing is listed, not checked', () => {
  let d: Design = { ...newDesign(), grid: { x: [1000, 1000], y: [1000, 1000], z: [] } };
  d = addMember(d, [0, 0, 0], [0, 2, 0], rect(80, 80, 3)).design;
  const floating = addMember(d, [1, 1, 0], [2, 1, 0], rect(40, 40, 2));
  const r = checkStrength(sceneOf(floating.design));
  assert.deepEqual(r.loose, [floating.id]);
  assert.equal(r.members.length, 1);
});

test('gate posts carry their leaves: weight on the hinges and the wind on the leaf', () => {
  const raw = JSON.parse(readFileSync(new URL('../../seed/demo-model.json', import.meta.url), 'utf8'));
  const p = prepareScene(raw.layout ?? raw);
  const r = checkStrength(p.scene);
  assert.ok(r.movers > 0);
  assert.equal(r.leavesMissing, 0);
  assert.equal(r.members.length, 2);
  // Each leaf's wind (about 1.9 by 1.75 of pickets and frame) bends its post at the ground
  for (const s of r.supports) assert.ok(s.moment > 1 && s.moment < 6, String(s.moment));
});
