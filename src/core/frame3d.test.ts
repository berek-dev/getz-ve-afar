import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPoints, forcesAt, midDisplacement, solveFrame } from './frame3d.ts';
import type { Frame, FrameElement } from './frame3d.ts';
import { sectionProps } from './sectionProps.ts';

const E = 210000;
const G = 81000;
const tube = sectionProps('rect_tube', [100, 50, 3])!;
const el = (a: number, b: number, y: [number, number, number] = [0, 1, 0], p = tube): FrameElement => ({ a, b, A: p.A, Iy: p.In, Iz: p.If, J: p.J, E, G, y });
const FIXED = [true, true, true, true, true, true];
const close = (actual: number, expected: number, rel = 1e-6) => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `${actual} vs ${expected}`);

test('section properties match the steel tables', () => {
  // 100/50/3: 864 mm², about 112 cm⁴ on its strong axis
  assert.equal(Math.round(tube.A), 864);
  close(tube.In, 1121192, 1e-3);
  assert.ok(tube.If < tube.In);
  const ipe = sectionProps('ipe', [160])!;
  // IPE 160: Iy ≈ 869 cm⁴ (fillets left out: a little less)
  assert.ok(ipe.In > 7.9e6 && ipe.In < 8.7e6, String(ipe.In));
  const angle = sectionProps('angle', [50, 50, 5])!;
  // L 50/50/5: about 11 cm⁴ on a leg axis, 4.6 on the weak axis
  assert.ok(angle.If > 10.5e4 && angle.If < 11.5e4, String(angle.If));
  assert.ok(angle.Imin > 4.2e4 && angle.Imin < 4.9e4, String(angle.Imin));
});

test('a cantilever bends PL³/3EI, both ways', () => {
  const frame: Frame = { nodes: [[0, 0, 0], [2000, 0, 0]], elements: [el(0, 1)], supports: new Map([[0, FIXED]]) };
  const r = solveFrame(frame, [{ nodal: new Map([[1, [0, -1000, 0, 0, 0, 0]]]) }, { nodal: new Map([[1, [0, 0, 500, 0, 0, 0]]]) }]);
  assert.ok(r.ok);
  if (!r.ok) return;
  // Element along x with local y up: a load down bends about z (If here)
  close(r.cases[0].u[1][1], (-1000 * 2000 ** 3) / (3 * E * tube.If));
  close(r.cases[1].u[1][2], (500 * 2000 ** 3) / (3 * E * tube.In));
  // The moment at the root is P·L
  const root = forcesAt(r.cases[0].elements[0], 0);
  close(Math.abs(root.Mz), 1000 * 2000);
});

test('a simply supported beam with a uniform load: 5qL⁴/384EI in the middle, qL²/8', () => {
  const frame: Frame = {
    nodes: [[0, 0, 0], [3000, 0, 0]],
    elements: [el(0, 1, [0, 0, 1])],
    supports: new Map([
      [0, [true, true, true, true, false, false]],
      [1, [false, true, true, false, false, false]],
    ]),
  };
  const q = -2; // N/mm down
  const r = solveFrame(frame, [{ line: new Map([[0, [0, q, 0]]]) }]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const res = r.cases[0].elements[0];
  // Local y is global z here, so the load runs along local z and bends with Iy (In)
  const mid = midDisplacement(frame, frame.elements[0], r.cases[0].u, res.q);
  close(mid[1], (5 * q * 3000 ** 4) / (384 * E * tube.In), 1e-9);
  const peak = Math.max(...checkPoints(res, 3000).map((x) => Math.abs(forcesAt(res, x).My)));
  close(peak, (2 * 3000 ** 2) / 8, 1e-9);
});

test('a portal frame sways as the textbook formula says', () => {
  const h = 2500;
  const L = 4000;
  const post = sectionProps('rect_tube', [100, 100, 4])!;
  const beam = sectionProps('rect_tube', [150, 100, 4])!;
  const frame: Frame = {
    nodes: [[0, 0, 0], [0, h, 0], [L, h, 0], [L, 0, 0]],
    elements: [
      // Posts: local y along X so the sway bends them about z with If
      { ...el(0, 1, [1, 0, 0], post), A: 1e9 },
      { ...el(1, 2, [0, 1, 0], beam), A: 1e9 },
      { ...el(3, 2, [1, 0, 0], post), A: 1e9 },
    ],
    supports: new Map([
      [0, FIXED],
      [3, FIXED],
    ]),
  };
  const H = 1000;
  const r = solveFrame(frame, [{ nodal: new Map([[1, [H, 0, 0, 0, 0, 0]]]) }]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const Ic = post.If;
  const Ib = beam.If;
  const k = Ib / L / (Ic / h);
  const expected = (H * h ** 3 * (3 * k + 2)) / (12 * E * Ic * (6 * k + 1));
  close(r.cases[0].u[1][0], expected, 1e-6);
});

test('a mechanism is found, and where', () => {
  // A post standing on a hinge that lets it fall over
  const frame: Frame = {
    nodes: [[0, 0, 0], [0, 2000, 0]],
    elements: [el(0, 1, [1, 0, 0])],
    supports: new Map([[0, [true, true, true, false, false, false]]]),
  };
  const r = solveFrame(frame, [{ nodal: new Map([[1, [100, 0, 0, 0, 0, 0]]]) }]);
  assert.equal(r.ok, false);
});
