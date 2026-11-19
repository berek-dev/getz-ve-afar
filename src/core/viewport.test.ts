import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FULL, MAX_ZOOM, clampViewport, keepUnder, pinch, toDrawing, viewBoxOf, zoomAt } from './viewport.ts';

const W = 360;
const H = 300;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('a pinch keeps the point between the fingers under them', () => {
  // Fingers 50 px apart around the drawing's middle, spread to 100: twice the zoom, the middle stays put
  const v = pinch(FULL, W, H, 0.5, 0.5, 50, 0.5, 0.5, 100);
  assert.equal(v.zoom, 2);
  const p = toDrawing(v, W, H, 0.5, 0.5);
  close(p.x, 180);
  close(p.y, 150);
  assert.equal(viewBoxOf(v, W, H), '90 75 180 150');
});

test('a pinch off-center zooms about the fingers, then the fingers drag the view along', () => {
  const v = pinch(FULL, W, H, 0.25, 0.25, 40, 0.25, 0.25, 160);
  const p = toDrawing(v, W, H, 0.25, 0.25);
  close(p.x, 90);
  close(p.y, 75);
  // Same distance, fingers move right by a tenth of the canvas: the view moves left by a tenth of what shows
  const moved = pinch(v, W, H, 0.5, 0.5, 30, 0.6, 0.5, 30);
  close(moved.x, v.x - (0.1 * W) / v.zoom);
  assert.equal(moved.zoom, v.zoom);
});

test('the view never leaves the drawing and the zoom stays in range', () => {
  assert.deepEqual(pinch(FULL, W, H, 0.5, 0.5, 100, 0.5, 0.5, 10), FULL); // can't zoom out past the whole drawing
  const deep = zoomAt(FULL, W, H, 100, 1, 1);
  assert.equal(deep.zoom, MAX_ZOOM);
  close(deep.x + W / deep.zoom, W); // zoomed at the bottom-right corner: the view ends at the drawing's edge
  close(deep.y + H / deep.zoom, H);
  assert.deepEqual(clampViewport({ x: -50, y: 9999, zoom: 2 }, W, H), { x: 0, y: 150, zoom: 2 });
  assert.equal(clampViewport({ x: 0, y: 0, zoom: Number.NaN }, W, H).zoom, 1);
});

test('the wheel zooms about the cursor', () => {
  const v = zoomAt(FULL, W, H, 2, 0.75, 0.2);
  const p = toDrawing(v, W, H, 0.75, 0.2);
  close(p.x, 270);
  close(p.y, 60);
  assert.deepEqual(keepUnder({ x: 180, y: 150 }, 1, 0.5, 0.5, W, H), FULL);
});
