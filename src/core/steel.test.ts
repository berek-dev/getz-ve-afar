import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES } from './steel.ts';

test('rectangular tube 60/40/2 ≈ 3.01 kg/m', () => {
  assert.equal(SHAPES.rect_tube.kg([60, 40, 2]), 3.014);
  assert.equal(SHAPES.rect_tube.name([60, 40, 2]), 'פרופיל 60/40/2');
});

test('square tube 80/80/3 ≈ 7.25 kg/m', () => {
  assert.equal(SHAPES.rect_tube.kg([80, 80, 3]), 7.253);
});

test('round tube, angle, flat, bar, plate', () => {
  assert.equal(SHAPES.round_tube.kg([60.3, 2.9]), 4.105); // π·57.4·2.9·0.00785
  assert.equal(SHAPES.angle.kg([40, 40, 4]), 2.386);
  assert.equal(SHAPES.flat.kg([40, 5]), 1.57);
  assert.equal(SHAPES.round_bar.kg([12]), 0.888);
  assert.equal(SHAPES.plate.kg([3]), 23.55);
});
