/**
 * Drawing by hand on a blank page, before any measurement (a finger on the phone, or a pen). Each stroke becomes a
 * straight line: almost level or plumb lines are made exactly so, and their ends snap to what is already drawn, so
 * points that line up share one coordinate. When the drawing is done, those coordinates become the grid and the
 * lines become members, every spacing marked as a guess (design.ts): the first measurement typed scales the whole
 * sketch, the others are corrected one by one.
 *
 * Page units are the pad's own drawing units, y pointing down (as on screen).
 */
import type { MaterialKey } from './catalog.ts';
import { addMember, allGuesses, newDesign } from './design.ts';
import type { Design, DesignNode, ProfileChoice } from './design.ts';
import { scribbleTarget, straighten } from './pen.ts';
import type { P2 } from './pen.ts';

export interface SketchLine {
  a: P2;
  b: P2;
}

/** How wide the page is taken to be before anything is measured, mm (only the proportions matter) */
export const SKETCH_PAGE_MM = 4000;

const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: P2, b: P2) => dist(a, b) < 1e-6;

/** The coordinate already used within `tol` of `v` (the nearest), or `v` itself */
function align(v: number, used: number[], tol: number): number {
  let best = v;
  let gap = tol;
  for (const u of used) {
    const d = Math.abs(u - v);
    if (d <= gap) {
      best = u;
      gap = d;
    }
  }
  return best;
}

/** An existing line end within `tol` of `p`, the nearest */
function nearEnd(p: P2, lines: SketchLine[], tol: number): P2 | null {
  let best: P2 | null = null;
  let gap = tol;
  for (const l of lines) {
    for (const e of [l.a, l.b]) {
      const d = dist(p, e);
      if (d <= gap) {
        best = e;
        gap = d;
      }
    }
  }
  return best;
}

/**
 * A stroke from `from` to `to` added to the drawing: straightened (within `degrees` of level or plumb), its ends
 * snapped to nearby line ends or lined up with coordinates already used (within `tol`). Null when it adds nothing:
 * too short once snapped, or the same line is already there.
 */
export function addSketchLine(lines: SketchLine[], from: P2, to: P2, tol: number, degrees = 10): SketchLine[] | null {
  const end = straighten(from, to, degrees);
  const xs = lines.flatMap((l) => [l.a.x, l.b.x]);
  const ys = lines.flatMap((l) => [l.a.y, l.b.y]);
  let a: P2;
  let b: P2;
  if (end.y === from.y && end.x !== from.x) {
    // Level: one height for both ends, lined up with a height already drawn
    const y = align((from.y + to.y) / 2, ys, tol);
    a = { x: align(from.x, xs, tol), y };
    b = { x: align(to.x, xs, tol), y };
  } else if (end.x === from.x && end.y !== from.y) {
    const x = align((from.x + to.x) / 2, xs, tol);
    a = { x, y: align(from.y, ys, tol) };
    b = { x, y: align(to.y, ys, tol) };
  } else {
    // A slanted line (a brace, a stair string): each end on a line end nearby, or lined up on its own
    const snap = (p: P2): P2 => nearEnd(p, lines, tol) ?? { x: align(p.x, xs, tol), y: align(p.y, ys, tol) };
    a = snap(from);
    b = snap(to);
  }
  if (dist(a, b) < 2 * tol) return null;
  if (lines.some((l) => (same(l.a, a) && same(l.b, b)) || (same(l.a, b) && same(l.b, a)))) return null;
  return [...lines, { a, b }];
}

/** The line a scribble covers, removed; null when it covers none */
export function eraseSketchLine(lines: SketchLine[], points: P2[], tol: number): SketchLine[] | null {
  const id = scribbleTarget(
    points,
    lines.map((l, i) => ({ id: String(i), x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y, w: 0 })),
    tol,
  );
  return id === null ? null : lines.filter((_, i) => String(i) !== id);
}

/**
 * The drawing as a design: every coordinate used becomes a grid line (rounded to `step` mm, coarser if there would
 * be more than 40 bays), the lowest point is the ground, each line is a member in `choice`, and every spacing is a
 * guess. `mmPerUnit` turns page units into millimetres. An axis drawn as a single line (one post) gets a 1,000 bay
 * beside it, since a grid needs one.
 */
export function sketchToDesign(
  lines: SketchLine[],
  opts: { mmPerUnit: number; choice: ProfileChoice; material?: MaterialKey; step?: number },
): Design {
  const base = newDesign(opts.material);
  if (lines.length === 0) return base;
  const ends = lines.flatMap((l) => [l.a, l.b]);
  const left = Math.min(...ends.map((p) => p.x));
  const bottom = Math.max(...ends.map((p) => p.y));
  const axis = (values: number[], step: number) => {
    const mm = (v: number) => Math.round((v * opts.mmPerUnit) / step) * step;
    const at = [...new Set(values.map(mm))].sort((p, q) => p - q);
    if (at.length === 1) at.push(at[0] + 1000);
    return { mm, at };
  };
  const fit = (values: number[]) => {
    let step = opts.step ?? 50;
    let r = axis(values, step);
    while (r.at.length > 41) r = axis(values, (step *= 2));
    return r;
  };
  const X = fit(ends.map((p) => p.x - left));
  const Y = fit(ends.map((p) => bottom - p.y));
  const spacings = (at: number[]) => at.slice(1).map((v, i) => v - at[i]);
  let design: Design = { ...base, grid: { x: spacings(X.at), y: spacings(Y.at), z: [] } };
  const node = (p: P2): DesignNode => [X.at.indexOf(X.mm(p.x - left)), Y.at.indexOf(Y.mm(bottom - p.y)), 0];
  for (const l of lines) design = addMember(design, node(l.a), node(l.b), opts.choice).design;
  return allGuesses(design);
}
