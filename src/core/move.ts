/**
 * Moving and turning what the builder placed: a member, an infill (its two members), a block or a plate. Ends land on
 * grid lines; where one lands between lines, a line is added there (`insertGridLine` keeps everything else in place),
 * so a piece keeps its size wherever it goes. Turning is by 90 degrees in the plane of the view, about the piece's
 * first point; a member can also be turned about its own axis (`roll`: a 60/40 tube laid on its side).
 */
import { elementOf, gridLines, insertGridLine, nodePosition, plateError, wallBox, wallError } from './design.ts';
import type { Design, DesignNode, GridAxis } from './design.ts';
import { placementError } from './blocks.ts';
import { SLOPE_UPS, add, dot, halfExtent, len, norm, plateAxes, plateCorners, scale, sectionAxes, sub } from './scene.ts';
import type { Profile, ResolvedScene, SlopeUp, Vec3 } from './scene.ts';

export type Element = { kind: 'member' | 'infill' | 'block' | 'plate' | 'wall'; id: string };
type End = { list: 'members' | 'blocks' | 'plates' | 'walls'; id: string; end: 'a' | 'b' };
type Result = { design: Design } | { error: string };

const AXES: GridAxis[] = ['x', 'y', 'z'];
const IDX: Record<GridAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/** The grid points that place an element */
function endsOf(design: Design, el: Element): End[] {
  const two = (list: End['list'], id: string): End[] => [
    { list, id, end: 'a' },
    { list, id, end: 'b' },
  ];
  switch (el.kind) {
    case 'member':
      return design.members.some((m) => m.id === el.id) ? two('members', el.id) : [];
    case 'block':
      return design.blocks.some((k) => k.id === el.id) ? two('blocks', el.id) : [];
    case 'plate':
      return design.plates.some((p) => p.id === el.id) ? two('plates', el.id) : [];
    case 'wall':
      return (design.walls ?? []).some((w) => w.id === el.id) ? two('walls', el.id) : [];
    case 'infill': {
      const f = design.infills.find((x) => x.id === el.id);
      return f ? f.between.flatMap((id) => two('members', id)) : [];
    }
  }
}

function nodeAt(design: Design, e: End): DesignNode {
  const item = ((design[e.list] ?? []) as { id: string; a: DesignNode; b: DesignNode }[]).find((x) => x.id === e.id);
  return item ? item[e.end] : [0, 0, 0];
}

/** Where an element's ends are, mm */
export function elementPoints(design: Design, el: Element): Vec3[] {
  return endsOf(design, el).map((e) => nodePosition(design.grid, nodeAt(design, e)));
}

/** Puts each end at its position (whole mm), adding grid lines where needed; checks the element still makes sense */
function place(design: Design, el: Element, ends: End[], targets: Vec3[]): Result {
  if (ends.length === 0) return { error: 'החלק לא נמצא.' };
  let d = design;
  const pos = targets.map((t) => t.map(Math.round) as Vec3);
  for (const axis of AXES) {
    const k = IDX[axis];
    const min = Math.min(...pos.map((p) => p[k]));
    if (min < 0) {
      if (axis === 'y') return { error: 'אי אפשר לרדת מתחת לקרקע.' };
      // A line before the first: the grid starts there now, so every position moves along by as much
      d = insertGridLine(d, axis, min).design;
      for (const p of pos) p[k] -= min;
    }
    for (const p of pos) d = insertGridLine(d, axis, p[k]).design;
  }
  const lines = { x: gridLines(d.grid.x), y: gridLines(d.grid.y), z: gridLines(d.grid.z) };
  const nodes: DesignNode[] = [];
  for (const p of pos) {
    const n: DesignNode = [0, 0, 0];
    for (const axis of AXES) {
      const i = lines[axis].findIndex((l) => Math.abs(l - p[IDX[axis]]) <= 0.5);
      if (i < 0) return { error: 'יש יותר מדי קווים ברשת. מחק קו כדי לפנות מקום.' };
      n[IDX[axis]] = i;
    }
    nodes.push(n);
  }
  for (let i = 0; i < ends.length; i++) {
    const e = ends[i];
    const list = ((d[e.list] ?? []) as { id: string }[]).map((x) => (x.id === e.id ? { ...x, [e.end]: nodes[i] } : x));
    d = { ...d, [e.list]: list };
  }
  // The same rules as placing it in the first place
  for (let i = 0; i < ends.length; i += 2) {
    const [a, b] = [nodes[i], nodes[i + 1]];
    if (a.join() === b.join()) return { error: 'שני הקצוות נפלו על אותה נקודה.' };
  }
  if (el.kind === 'block') {
    const block = d.blocks.find((k) => k.id === el.id);
    const wrong = block && placementError(block.kind, block.a, block.b);
    if (wrong) return { error: wrong };
  }
  if (el.kind === 'plate') {
    const plate = d.plates.find((p) => p.id === el.id);
    const wrong = plate && plateError(plate.a, plate.b);
    if (wrong) return { error: wrong };
  }
  if (el.kind === 'wall') {
    const wall = d.walls?.find((w) => w.id === el.id);
    const wrong = wall && wallError(wall.a, wall.b);
    if (wrong) return { error: wrong };
  }
  return { design: d };
}

/** Moves an element by `delta` mm */
export function moveElement(design: Design, el: Element, delta: Vec3): Result {
  const ends = endsOf(design, el);
  const at = ends.map((e) => nodePosition(design.grid, nodeAt(design, e)));
  return place(design, el, ends, at.map((p) => [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]]));
}

/**
 * The step to move along `axis` for a drag of `raw` mm: one that brings an end of the element onto a grid line when
 * that is within `tol`, otherwise the drag itself to the nearest 10 mm.
 */
export function snapDelta(design: Design, el: Element, axis: GridAxis, raw: number, tol: number): number {
  const k = IDX[axis];
  const lines = gridLines(design.grid[axis]);
  let best: number | null = null;
  for (const p of elementPoints(design, el)) {
    for (const l of lines) {
      const d = l - p[k];
      if (Math.abs(d - raw) <= tol && (best === null || Math.abs(d - raw) < Math.abs(best - raw))) best = d;
    }
  }
  return best ?? Math.round(raw / 10) * 10;
}

/**
 * The move to the next grid line in a direction (`sign` +1 or -1 along `axis`): the nearest step that brings one of
 * the element's ends onto a line further that way. Null when there is none (it would leave the grid).
 */
export function stepDelta(design: Design, el: Element, axis: GridAxis, sign: 1 | -1): number | null {
  const k = IDX[axis];
  const lines = gridLines(design.grid[axis]);
  let best: number | null = null;
  for (const p of elementPoints(design, el)) {
    for (const l of lines) {
      const d = l - p[k];
      if (d * sign > 0.5 && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

const turn = (u: number, v: number, cw: boolean) => (cw ? [-v, u] : [v, -u]);
const SLOPE_VEC: Record<SlopeUp, [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };

/**
 * Turns an element 90 degrees in the plane of a view (u across, v the view's second axis) about its first point:
 * clockwise as the view shows it, or the other way when that leaves the grid. In plan a roof's slope turns with it;
 * turned up out of the level, a plate loses its slope.
 */
export function rotateElement(design: Design, el: Element, axes: { u: GridAxis; v: GridAxis }): Result {
  const ends = endsOf(design, el);
  if (ends.length === 0) return { error: 'החלק לא נמצא.' };
  const at = ends.map((e) => nodePosition(design.grid, nodeAt(design, e)));
  const pivot = at[0];
  const [ui, vi] = [IDX[axes.u], IDX[axes.v]];
  // On screen v points down in plan and up in the front and side views: "clockwise" swaps with it
  const screenDown = axes.v !== 'y';
  let first: Result | null = null;
  for (const cw of screenDown ? [true, false] : [false, true]) {
    const targets = at.map((p) => {
      const [du, dv] = turn(p[ui] - pivot[ui], p[vi] - pivot[vi], cw);
      const out: Vec3 = [p[0], p[1], p[2]];
      out[ui] = pivot[ui] + du;
      out[vi] = pivot[vi] + dv;
      return out;
    });
    const r = place(design, el, ends, targets);
    if ('design' in r) return el.kind === 'plate' ? { design: turnSlope(r.design, el.id, axes, cw) } : r;
    first ??= r;
  }
  return first ?? { error: 'אין מקום לסובב כאן.' };
}

/** A turned plate's slope: turned with it in plan, gone when the plate is no longer level */
function turnSlope(design: Design, id: string, axes: { u: GridAxis; v: GridAxis }, cw: boolean): Design {
  return {
    ...design,
    plates: design.plates.map((p) => {
      if (p.id !== id || !p.slope) return p;
      const { slope, ...rest } = p;
      if (p.a[1] !== p.b[1]) return rest;
      if (axes.v !== 'z') return p;
      const [x, z] = SLOPE_VEC[slope.up];
      const [nx, nz] = turn(x, z, cw);
      const up = SLOPE_UPS.find((key) => SLOPE_VEC[key][0] === Math.round(nx) && SLOPE_VEC[key][1] === Math.round(nz));
      return up ? { ...rest, slope: { ...slope, up } } : p;
    }),
  };
}

/** Profiles that look different turned a quarter about their own axis */
export function rollMatters(profile: Profile, size: number[]): boolean {
  if (profile === 'rect_tube') return size[0] !== size[1];
  return profile === 'flat' || profile === 'angle' || profile === 'upn' || profile === 'ipe' || profile === 'hea';
}

/** Two ways only for shapes that look the same turned half round */
const HALF: readonly Profile[] = ['rect_tube', 'flat', 'ipe', 'hea'];

/** A member turned a quarter about its own axis */
export function rollMember(design: Design, id: string): Design {
  return {
    ...design,
    members: design.members.map((m) => {
      if (m.id !== id) return m;
      const next = ((m.roll ?? 0) + 90) % (HALF.includes(m.profile) ? 180 : 360);
      const { roll: _old, ...rest } = m;
      return next === 0 ? rest : { ...rest, roll: next };
    }),
  };
}

const sameElement = (a: Element, b: Element) => a.kind === b.kind && a.id === b.id;

/**
 * Where an element's steel reaches along an axis (0 x, 1 y, 2 z), outside faces included: from the compiled scene's
 * pieces that belong to it (base plates left out, so a post is measured by its tube). Null when nothing is drawn.
 */
export function extentAlong(design: Design, scene: ResolvedScene, el: Element, k: 0 | 1 | 2): [number, number] | null {
  if (el.kind === 'wall') {
    const w = design.walls?.find((x) => x.id === el.id);
    if (!w) return null;
    const box = wallBox(design, w);
    return [box.center[k] - box.size[k] / 2, box.center[k] + box.size[k] / 2];
  }
  let lo = Infinity;
  let hi = -Infinity;
  const along: Vec3 = [0, 0, 0];
  along[k] = 1;
  for (const m of scene.members) {
    const of = elementOf(design, m.id);
    if (!of || !sameElement(of, el)) continue;
    const { f, n } = sectionAxes(norm(sub(m.to, m.from)));
    const half = halfExtent(m, f, n, along);
    lo = Math.min(lo, m.from[k] - half, m.to[k] - half);
    hi = Math.max(hi, m.from[k] + half, m.to[k] + half);
  }
  for (const p of scene.plates) {
    if (p.id.endsWith('-base')) continue;
    const of = elementOf(design, p.id);
    if (!of || !sameElement(of, el)) continue;
    const half = (Math.abs(plateAxes(p).n[k]) * p.thickness) / 2;
    for (const c of plateCorners(p)) {
      lo = Math.min(lo, c[k] - half);
      hi = Math.max(hi, c[k] + half);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

export interface Centred {
  design: Design;
  axis: GridAxis;
  /** Clear space left on each side, mm (negative when it doesn't fit) */
  gap: number;
}

/**
 * Moves an element to the middle of the clear space between two others, along whichever of the view's two axes
 * they stand apart on (face to face; centre to centre when they overlap on both).
 */
export function centerBetween(design: Design, scene: ResolvedScene, el: Element, a: Element, b: Element, axes: { u: GridAxis; v: GridAxis }): Centred | { error: string } {
  if (sameElement(a, b) || sameElement(a, el) || sameElement(b, el)) return { error: 'בוחרים שני חלקים אחרים, שונים זה מזה.' };
  type Side = { axis: GridAxis; k: 0 | 1 | 2; ea: [number, number]; eb: [number, number]; gap: number; apart: number };
  const sides: Side[] = [];
  for (const axis of [axes.u, axes.v]) {
    const k = IDX[axis];
    const ea = extentAlong(design, scene, a, k);
    const eb = extentAlong(design, scene, b, k);
    if (!ea || !eb) return { error: 'החלק לא נמצא.' };
    // The clear space between them (negative when they overlap), and how far their middles are apart
    sides.push({ axis, k, ea, eb, gap: Math.max(eb[0] - ea[1], ea[0] - eb[1]), apart: Math.abs(ea[0] + ea[1] - eb[0] - eb[1]) / 2 });
  }
  // Face to face along the axis with the most clear space; centre to centre when they overlap on both
  const open = sides.filter((x) => x.gap > 0).sort((x, y) => y.gap - x.gap)[0];
  const side = open ?? sides.sort((x, y) => y.apart - x.apart)[0];
  if (!side || (!open && side.apart < 1)) return { error: 'שני החלקים באותו מקום: אין בין מה למרכז.' };
  const { axis, k, ea, eb } = side;
  const target = open ? (eb[0] >= ea[1] ? (ea[1] + eb[0]) / 2 : (eb[1] + ea[0]) / 2) : (ea[0] + ea[1] + eb[0] + eb[1]) / 4;
  const own = extentAlong(design, scene, el, k);
  if (!own) return { error: 'החלק לא נמצא.' };
  const delta: Vec3 = [0, 0, 0];
  delta[k] = Math.round(target - (own[0] + own[1]) / 2);
  const r = delta[k] === 0 ? { design } : moveElement(design, el, delta);
  if ('error' in r) return r;
  return { design: r.design, axis, gap: open ? (open.gap - (own[1] - own[0])) / 2 : 0 };
}

export interface Snapped {
  design: Design;
  /** Stretched (or shortened) along its own line, or slid without turning */
  how: 'stretch' | 'move';
  /** How far it went, mm */
  mm: number;
  /** Stretched longer (false: shortened) */
  grew?: boolean;
}

/** A target's centre line (a member) or face (a wall, a plate): what a member's end can reach along its own line */
function reachTarget(design: Design, target: Element): { line: [Vec3, Vec3] } | { plane: { at: Vec3; n: Vec3; corners: Vec3[] } } | null {
  if (target.kind === 'member') {
    const m = design.members.find((x) => x.id === target.id);
    return m ? { line: [nodePosition(design.grid, m.a), nodePosition(design.grid, m.b)] } : null;
  }
  if (target.kind === 'wall' || target.kind === 'plate') {
    const item = target.kind === 'wall' ? design.walls?.find((w) => w.id === target.id) : design.plates.find((p) => p.id === target.id);
    if (!item) return null;
    const pa = nodePosition(design.grid, item.a);
    const pb = nodePosition(design.grid, item.b);
    const k = ([0, 1, 2] as const).find((i) => item.a[i] === item.b[i]);
    if (k === undefined) return null;
    const n: Vec3 = [0, 0, 0];
    n[k] = 1;
    const corners = [pa, pb];
    return { plane: { at: pa, n, corners } };
  }
  return null;
}

/**
 * Brings a piece up against another without turning it. A member whose line meets the target (another member's
 * centre line, a wall's or plate's face) is stretched or shortened at its nearer end to reach it, the other end staying
 * put; anything else slides the shortest way, along the view's axes, until its outside touches the target's.
 */
export function snapTo(design: Design, scene: ResolvedScene, el: Element, target: Element, axes: { u: GridAxis; v: GridAxis }): Snapped | { error: string } {
  if (sameElement(el, target)) return { error: 'בוחרים חלק אחר להצמיד אליו.' };
  if (el.kind === 'member') {
    const m = design.members.find((x) => x.id === el.id);
    const t = reachTarget(design, target);
    if (m && t) {
      const P0 = nodePosition(design.grid, m.a);
      const P1 = nodePosition(design.grid, m.b);
      const L = len(sub(P1, P0));
      const d = norm(sub(P1, P0));
      // Where the member's own line reaches the target (distance from P0 along d), if it does
      let s: number | null = null;
      if ('line' in t) {
        const [Q0, Q1] = t.line;
        const LT = len(sub(Q1, Q0));
        const e = norm(sub(Q1, Q0));
        const w0 = sub(P0, Q0);
        const b = dot(d, e);
        const den = 1 - b * b;
        if (den > 1e-6) {
          const sp = (b * dot(e, w0) - dot(d, w0)) / den;
          const tq = (dot(e, w0) - b * dot(d, w0)) / den;
          const gap = len(sub(add(P0, scale(d, sp)), add(Q0, scale(e, tq))));
          if (gap < 5 && tq > -5 && tq < LT + 5) s = sp;
        }
      } else {
        const { at, n, corners } = t.plane;
        const dn = dot(d, n);
        if (Math.abs(dn) > 1e-6) {
          const sp = dot(sub(at, P0), n) / dn;
          const X = add(P0, scale(d, sp));
          const inside = [0, 1, 2].every((k) => X[k] >= Math.min(corners[0][k], corners[1][k]) - 5 && X[k] <= Math.max(corners[0][k], corners[1][k]) + 5);
          if (inside) s = sp;
        }
      }
      if (s !== null) {
        // The nearer end goes there; the member keeps its direction and some length
        const moveB = Math.abs(s - L) < Math.abs(s);
        const fixedAt = moveB ? 0 : L;
        const newLen = Math.abs(s - fixedAt);
        const sameWay = moveB ? s > 0 : s < L;
        if (newLen >= 50 && sameWay) {
          const mm = Math.abs(s - (moveB ? L : 0));
          if (mm < 0.5) return { error: 'החלק כבר צמוד.' };
          const X = add(P0, scale(d, s));
          const ends = endsOf(design, el);
          const r = place(design, el, ends, moveB ? [P0, X] : [X, P1]);
          if ('error' in r) return r;
          return { design: r.design, how: 'stretch', mm, grew: newLen > L };
        }
      }
    }
  }
  // Slide: close the gap between the outsides on each of the view's axes where there is one
  const delta: Vec3 = [0, 0, 0];
  for (const axis of [axes.u, axes.v]) {
    const k = IDX[axis];
    const a = extentAlong(design, scene, el, k);
    const b = extentAlong(design, scene, target, k);
    if (!a || !b) return { error: 'החלק לא נמצא.' };
    if (a[1] <= b[0]) delta[k] = b[0] - a[1];
    else if (a[0] >= b[1]) delta[k] = b[1] - a[0];
  }
  const mm = len(delta);
  if (mm < 0.5) return { error: 'החלק כבר צמוד.' };
  const r = moveElement(design, el, delta.map(Math.round) as Vec3);
  if ('error' in r) return r;
  return { design: r.design, how: 'move', mm };
}
