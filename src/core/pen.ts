/**
 * Pen mode: what a stroke on the grid means. A short touch is a tap, a straight stroke is a part between two
 * points, a scribble erases what it covers. Line ends snap to grid points; where the pen lands between grid lines,
 * a new grid line goes there (rounded to 10 mm), so a sketch made by eye becomes measurements to correct.
 */
import { gridLines, insertGridLine } from './design.ts';
import type { Design, DesignNode, GridAxis } from './design.ts';

export interface P2 {
  x: number;
  y: number;
}

export type Stroke = { kind: 'tap'; at: P2 } | { kind: 'line'; from: P2; to: P2 } | { kind: 'scribble' } | { kind: 'other' };

const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(points: P2[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += dist(points[i - 1], points[i]);
  return s;
}

/** How far the stroke strays from the straight line between its ends, at most */
function deviation(points: P2[]): number {
  const a = points[0];
  const b = points[points.length - 1];
  const L = dist(a, b);
  if (L === 0) return Math.max(...points.map((p) => dist(p, a)));
  return Math.max(...points.map((p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L));
}

/** Times the stroke turns back along its longer direction (a scribble goes back and forth) */
function reversals(points: P2[], tol: number): number {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  let turns = 0;
  let dir = 0;
  let anchor = alongX ? xs[0] : ys[0];
  for (const p of points) {
    const v = alongX ? p.x : p.y;
    const d = v - anchor;
    if (Math.abs(d) < tol) continue;
    const s = Math.sign(d);
    if (dir !== 0 && s !== dir) turns++;
    dir = s;
    anchor = v;
  }
  return turns;
}

/** What a stroke is. `tol` is a small distance in the stroke's units (a few screen pixels). */
export function classifyStroke(points: P2[], tol: number): Stroke {
  if (points.length === 0) return { kind: 'other' };
  const first = points[0];
  const last = points[points.length - 1];
  const len = pathLength(points);
  if (len < tol) return { kind: 'tap', at: first };
  const chord = dist(first, last);
  if (len > 2.5 * Math.max(chord, tol) && reversals(points, tol) >= 2) return { kind: 'scribble' };
  if (chord >= 3 * tol && deviation(points) <= Math.max(tol, 0.1 * chord)) return { kind: 'line', from: first, to: last };
  return { kind: 'other' };
}

/** A line drawn almost level or plumb (within `degrees`) made exactly so, keeping its start */
export function straighten(from: P2, to: P2, degrees = 8): P2 {
  const angle = (Math.atan2(Math.abs(to.y - from.y), Math.abs(to.x - from.x)) * 180) / Math.PI;
  if (angle <= degrees) return { x: to.x, y: from.y };
  if (angle >= 90 - degrees) return { x: from.x, y: to.y };
  return to;
}

/** A coordinate on a grid axis: the line within `tol`, or where a new line would go (rounded to 10 mm) */
export function snapToLine(value: number, lines: number[], tol: number): { index: number } | { insert: number } {
  let best = -1;
  for (let k = 0; k < lines.length; k++) if (Math.abs(lines[k] - value) <= tol && (best < 0 || Math.abs(lines[k] - value) < Math.abs(lines[best] - value))) best = k;
  return best >= 0 ? { index: best } : { insert: Math.round(value / 10) * 10 };
}

/**
 * The two grid points of a pen line drawn in a view: `from`/`to` are in mm along the view's across (u) and up (v)
 * axes, on plane line `line`. New grid lines are added where the ends fall between lines (as guesses, see
 * design.ts). A line within `degrees` of level or plumb is made exactly so (a finger gets a little more room than
 * a pen). Returns the design with those lines, the two points, and how many lines were added.
 */
export function penSegment(
  design: Design,
  axes: { u: GridAxis; v: GridAxis; p: GridAxis },
  line: number,
  from: { u: number; v: number },
  to: { u: number; v: number },
  tolMm: number,
  degrees = 8,
): { design: Design; a: DesignNode; b: DesignNode; added: number } {
  const end = straighten({ x: from.u, y: from.v }, { x: to.u, y: to.v }, degrees);
  const ends = [
    { u: from.u, v: from.v },
    { u: end.x, v: end.y },
  ];
  let d = design;
  let added = 0;
  const node = (u: number, v: number): DesignNode => {
    const n: DesignNode = [0, 0, 0];
    const set = (axis: GridAxis, value: number, slot: 0 | 1 | 2) => {
      const snap = snapToLine(value, gridLines(d.grid[axis]), tolMm);
      if ('index' in snap) {
        n[slot] = snap.index;
        return;
      }
      const before = d.grid[axis].length;
      const r = insertGridLine(d, axis, snap.insert);
      if (r.design.grid[axis].length > before) added++;
      d = r.design;
      n[slot] = r.index;
    };
    const slot = (axis: GridAxis) => ({ x: 0, y: 1, z: 2 })[axis] as 0 | 1 | 2;
    set(axes.u, u, slot(axes.u));
    set(axes.v, v, slot(axes.v));
    n[slot(axes.p)] = line;
    return n;
  };
  node(ends[0].u, ends[0].v);
  const b = node(ends[1].u, ends[1].v);
  // A line added for the second end may have moved the first end's indices: find it again (adds nothing now)
  const a = node(ends[0].u, ends[0].v);
  return { design: d, a, b, added };
}

/** Which drawn piece a scribble covers: the one most of its points lie near (segments in the stroke's units) */
export function scribbleTarget(points: P2[], segments: { id: string; x1: number; y1: number; x2: number; y2: number; w: number }[], tol: number): string | null {
  let best: { id: string; hits: number } | null = null;
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const L2 = dx * dx + dy * dy;
    let hits = 0;
    for (const p of points) {
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / L2)) : 0;
      if (dist(p, { x: s.x1 + t * dx, y: s.y1 + t * dy }) <= tol + s.w / 2) hits++;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { id: s.id, hits };
  }
  return best && best.hits >= Math.max(2, points.length * 0.3) ? best.id : null;
}
