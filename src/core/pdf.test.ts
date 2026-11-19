import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PAGE_POINTS, imagePdf } from './pdf.ts';

/** A small gray image: white with a black frame */
function frame(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h).fill(255);
  for (let x = 0; x < w; x++) px[x] = px[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) px[y * w] = px[y * w + w - 1] = 0;
  return px;
}

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

test('a one-page PDF: every object where the cross-reference table says it is', () => {
  const pdf = imagePdf({ width: 420, height: 297, gray: true, data: deflateSync(frame(420, 297)) }, { page: 'A3', title: 'שער כניסה', date: new Date(Date.UTC(2026, 10, 19, 12, 0, 0)) });
  const text = latin1(pdf);
  assert.ok(text.startsWith('%PDF-1.4\n%'));
  assert.ok(pdf[10] >= 128, 'binary marker');
  assert.ok(text.endsWith('%%EOF\n'));
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  assert.ok(text.slice(startxref).startsWith('xref\n0 7\n'));
  const rows = text.slice(startxref).split('\n').slice(3, 9);
  rows.forEach((row, i) => assert.ok(text.slice(Number(row.slice(0, 10))).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.match(text, /\/MediaBox \[0 0 1190.55 841.89\]/);
  assert.match(text, /\/Title <FEFF05E905E205E8002005DB05E005D905E105D4>/);
  assert.match(text, /\/CreationDate \(D:20261119120000Z\)/);
});

test('the image fills the page, keeping its proportions and centered', () => {
  const pdf = latin1(imagePdf({ width: 400, height: 400, gray: false, data: deflateSync(new Uint8Array(400 * 400 * 3)) }, { page: 'A4' }));
  const [W, H] = PAGE_POINTS.A4;
  const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im0 Do Q/.exec(pdf);
  assert.ok(m);
  assert.equal(Number(m[1]), H); // square image: as tall as the page
  assert.equal(Number(m[3]), Math.round(((W - H) / 2) * 100) / 100);
  assert.match(pdf, /\/ColorSpace \/DeviceRGB/);
  assert.ok(!pdf.includes('/Title'));
});
