/**
 * Moving and turning what the builder placed: a member, an infill (its two members), a block or a plate. Ends land on
 * grid lines; where one lands between lines, a line is added there (`insertGridLine` keeps everything else in place),
 * so a piece keeps its size wherever it goes. Turning is by 90 degrees in the plane of the view, about the piece's
 * first point; a member can also be turned about its own axis (`roll`: a 60/40 tube laid on its side).
 */
import { gridLines, insertGridLine, nodePosition, plateError } from './design.ts';
import type { Design, DesignNode, GridAxis } from './design.ts';
import { placementError } from './blocks.ts';
import { SLOPE_UPS } from './scene.ts';
import type { Profile, SlopeUp, Vec3 } from './scene.ts';

export type Element = { kind: 'member' | 'infill' | 'block' | 'plate'; id: string };
type End = { list: 'members' | 'blocks' | 'plates'; id: string; end: 'a' | 'b' };
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
    case 'infill': {
      const f = design.infills.find((x) => x.id === el.id);
      return f ? f.between.flatMap((id) => two('members', id)) : [];
    }
  }
}

function nodeAt(design: Design, e: End): DesignNode {
  const item = (design[e.list] as { id: string; a: DesignNode; b: DesignNode }[]).find((x) => x.id === e.id);
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
    const list = (d[e.list] as { id: string }[]).map((x) => (x.id === e.id ? { ...x, [e.end]: nodes[i] } : x));
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
