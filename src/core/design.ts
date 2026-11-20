/**
 * A design built by hand, without AI: a grid of typed spacings, members between grid points, base plates and
 * infill bars. It compiles to the same layout JSON (scene.ts) the 3D viewer, shop drawing and cut list use, and
 * travels inside that layout as `design`, so the builder can open it again.
 *
 * Grid: spacings along X (left to right), Y (levels, from the ground up) and Z (back to front, towards the
 * street), each in mm. A node is [xi, yi, zi], indices of grid lines (0 = the first line).
 */
import type { MaterialKey } from './catalog.ts';
import { beamSizes } from './sections.ts';
import { PROFILES, add, dot, halfExtent, len, norm, scale, sectionAxes, sub } from './scene.ts';
import type { Dimension, Member, Part, Plate, Profile, Vec3 } from './scene.ts';
import { BLOCK_KINDS, buildBlock, newBlock, placementError } from './blocks.ts';
import type { BlockKind, DesignBlock, Frame, FrameInfill } from './blocks.ts';

export type GridAxis = 'x' | 'y' | 'z';
export type DesignNode = [number, number, number];

export interface DesignGrid {
  x: number[];
  y: number[];
  z: number[];
}

export interface BasePlate {
  /** Along X and Z, mm */
  w: number;
  d: number;
  t: number;
}

export interface DesignMember {
  id: string;
  a: DesignNode;
  b: DesignNode;
  profile: Profile;
  size: number[];
  label?: string;
  /** A plate under the member's lower end, when that end is on the ground */
  base?: BasePlate | null;
}

export interface DesignInfill {
  id: string;
  /** Two parallel members; bars run square to them, from one to the other */
  between: [string, string];
  profile: Profile;
  size: number[];
  /** Largest clear gap between bars, mm */
  gap: number;
}

export interface Design {
  version: 1;
  grid: DesignGrid;
  members: DesignMember[];
  infills: DesignInfill[];
  /** Stairs, platforms, railings, ladders and gates (blocks.ts) */
  blocks: DesignBlock[];
  material: MaterialKey;
}

export interface ProfileChoice {
  profile: Profile;
  size: number[];
}

export const PROFILE_LABELS: Record<Profile, string> = {
  rect_tube: 'פרופיל',
  angle: 'זוויתן',
  flat: 'פלח',
  round_tube: 'צינור',
  round_bar: 'מוט עגול',
  square_bar: 'מוט מרובע',
  ipe: 'IPE',
  hea: 'HEA',
  upn: 'UPN',
};

/** A few sizes to pick from per profile; any other size can be typed */
export const COMMON_SIZES: Record<Profile, number[][]> = {
  rect_tube: [[40, 40, 2], [50, 50, 3], [60, 40, 2], [60, 60, 3], [80, 40, 3], [80, 80, 3], [100, 50, 3], [100, 100, 4], [120, 60, 4], [150, 100, 5]],
  angle: [[30, 30, 3], [40, 40, 4], [50, 50, 5], [60, 60, 6], [80, 80, 8]],
  flat: [[30, 5], [40, 5], [50, 8], [60, 10], [100, 10]],
  round_tube: [[33.7, 2.6], [42.4, 2.6], [48.3, 2.9], [60.3, 2.9], [88.9, 3.2], [114.3, 3.6]],
  round_bar: [[10], [12], [16], [20]],
  square_bar: [[12], [14], [16], [20]],
  ipe: beamSizes('ipe').filter((h) => h <= 300).map((h) => [h]),
  hea: beamSizes('hea').filter((h) => h <= 300).map((h) => [h]),
  upn: beamSizes('upn').filter((h) => h <= 300).map((h) => [h]),
};

/** How many numbers a size takes ("60/40/2" = 3) */
export const SIZE_PARTS: Record<Profile, number> = {
  rect_tube: 3,
  angle: 3,
  flat: 2,
  round_tube: 2,
  round_bar: 1,
  square_bar: 1,
  ipe: 1,
  hea: 1,
  upn: 1,
};

/** "60/40/2" → [60, 40, 2]; null when it doesn't fit the profile */
export function parseSize(profile: Profile, text: string): number[] | null {
  const nums = text
    .split(/[/x×*\s]+/)
    .filter(Boolean)
    .map(Number);
  if (nums.length === 0 || nums.some((n) => !Number.isFinite(n) || n <= 0 || n > 2000)) return null;
  const want = SIZE_PARTS[profile];
  if (profile === 'rect_tube' && nums.length === 2) return [nums[0], nums[0], nums[1]]; // "50/3" = square 50/50/3
  if (profile === 'angle' && nums.length === 2) return [nums[0], nums[0], nums[1]];
  if (nums.length !== want) return null;
  if ((profile === 'ipe' || profile === 'hea' || profile === 'upn') && !beamSizes(profile).includes(nums[0])) return null;
  return nums;
}

export const sizeText = (size: number[]) => size.join('/');

export function newDesign(material: MaterialKey = 'black'): Design {
  return { version: 1, grid: { x: [2000], y: [2000], z: [] }, members: [], infills: [], blocks: [], material };
}

// ------------------------------------------------------------------------------------------- reading

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const spacingList = (v: unknown, allowEmpty: boolean): number[] | null => {
  if (!Array.isArray(v) || v.length > 40 || (!allowEmpty && v.length === 0)) return null;
  return v.every((s) => isNum(s) && s > 0 && s <= 60_000) ? (v as number[]) : null;
};
const nodeOf = (v: unknown): DesignNode | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0) ? [v[0], v[1], v[2]] : null;

/** A stored design (from a saved layout), or null if it isn't one */
export function readDesign(raw: unknown): Design | null {
  const d = raw as Partial<Design> | null;
  if (!d || typeof d !== 'object' || d.version !== 1 || !d.grid) return null;
  const x = spacingList(d.grid.x, false);
  const y = spacingList(d.grid.y, false);
  const z = spacingList(d.grid.z ?? [], true);
  if (!x || !y || !z) return null;
  const members: DesignMember[] = [];
  for (const m of Array.isArray(d.members) ? d.members : []) {
    const a = nodeOf(m?.a);
    const b = nodeOf(m?.b);
    if (!a || !b || typeof m.id !== 'string' || !Array.isArray(m.size)) continue;
    members.push({ ...m, a, b });
  }
  const ids = new Set(members.map((m) => m.id));
  const infills = (Array.isArray(d.infills) ? d.infills : []).filter(
    (f) => f && typeof f.id === 'string' && Array.isArray(f.between) && ids.has(f.between[0]) && ids.has(f.between[1]) && isNum(f.gap) && f.gap > 0,
  );
  const blocks: DesignBlock[] = [];
  for (const raw of Array.isArray(d.blocks) ? (d.blocks as unknown[]) : []) {
    const k = raw as Partial<DesignBlock> | null;
    const a = nodeOf(k?.a);
    const b = nodeOf(k?.b);
    if (!k || !a || !b || typeof k.id !== 'string' || !BLOCK_KINDS.includes(k.kind as BlockKind)) continue;
    const params: Record<string, number> = {};
    for (const [key, v] of Object.entries(k.params ?? {})) if (isNum(v)) params[key] = v;
    const profiles: Record<string, ProfileChoice> = {};
    for (const [key, v] of Object.entries(k.profiles ?? {})) {
      const c = v as Partial<ProfileChoice> | null;
      if (c && PROFILES.includes(c.profile as Profile) && Array.isArray(c.size) && c.size.length > 0 && c.size.every((n) => isNum(n) && n > 0)) {
        profiles[key] = { profile: c.profile as Profile, size: c.size };
      }
    }
    blocks.push({ id: k.id, kind: k.kind as BlockKind, a, b, params, profiles });
  }
  return { version: 1, grid: { x, y, z }, members, infills, blocks, material: (d.material as MaterialKey) ?? 'black' };
}

// ------------------------------------------------------------------------------------------ geometry

/** Grid line positions along an axis: 0, then the running sum of the spacings */
export function gridLines(spacings: number[]): number[] {
  const out = [0];
  for (const s of spacings) out.push(out[out.length - 1] + s);
  return out;
}

export function nodePosition(grid: DesignGrid, n: DesignNode): Vec3 {
  return [gridLines(grid.x).at(n[0]) ?? 0, gridLines(grid.y).at(n[1]) ?? 0, gridLines(grid.z).at(n[2]) ?? 0];
}

export function nodeInGrid(grid: DesignGrid, n: DesignNode): boolean {
  return n[0] <= grid.x.length && n[1] <= grid.y.length && n[2] <= grid.z.length;
}

const UP: Vec3 = [0, 1, 0];
const sameNode = (a: DesignNode, b: DesignNode) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const isVertical = (d: Vec3) => Math.abs(d[1]) > 0.9;
const parallel = (a: Vec3, b: Vec3) => Math.abs(dot(a, b)) > 0.995;
const sectionSize = (m: Frame) => Math.max(...m.size.slice(0, 2));

interface Resolved {
  m: Frame;
  from: Vec3;
  to: Vec3;
  dir: Vec3;
  plate?: Plate;
}

/** Everything a design places: its frame (members and the blocks' frame pieces) and the blocks' other pieces */
interface Collected {
  frames: Frame[];
  members: Member[];
  plates: Plate[];
  parts: Part[];
  infills: FrameInfill[];
  notes: string[];
  reports: Map<string, { info: string[]; warn: string | null }>;
}

function collect(design: Design): Collected {
  const { grid } = design;
  const frames: Frame[] = design.members
    .filter((m) => nodeInGrid(grid, m.a) && nodeInGrid(grid, m.b) && !sameNode(m.a, m.b))
    .map((m) => ({ id: m.id, profile: m.profile, size: m.size, from: nodePosition(grid, m.a), to: nodePosition(grid, m.b), label: m.label, base: m.base ?? null }));
  const out: Collected = { frames, members: [], plates: [], parts: [], infills: [...design.infills], notes: [], reports: new Map() };
  // Platforms first, so a railing placed on one knows it
  const order = [...design.blocks].sort((a, b) => Number(b.kind === 'platform') - Number(a.kind === 'platform'));
  for (const block of order) {
    const wrong = !nodeInGrid(grid, block.a) || !nodeInGrid(grid, block.b) ? 'הנקודות של הבלוק כבר לא ברשת.' : placementError(block.kind, block.a, block.b);
    if (wrong) {
      out.reports.set(block.id, { info: [], warn: wrong });
      continue;
    }
    const o = buildBlock(block, nodePosition(grid, block.a), nodePosition(grid, block.b), frames);
    frames.push(...o.frames);
    out.members.push(...o.members);
    out.plates.push(...o.plates);
    out.parts.push(...o.parts);
    out.infills.push(...o.infills);
    out.notes.push(...o.notes);
    out.reports.set(block.id, { info: o.info, warn: o.warn });
  }
  return out;
}

/**
 * Member ends at shared points, as a shop builds them: one member runs through (a column, or a member the point
 * lies on, or the bigger section), the others stop at its face; a through member that ends there runs on to cover
 * the joint. Members in line just meet.
 */
function resolveJoints(frames: Frame[]): Resolved[] {
  const list: Resolved[] = frames.filter((m) => len(sub(m.to, m.from)) > 0.5).map((m) => ({ m, from: m.from, to: m.to, dir: norm(sub(m.to, m.from)) }));
  const key = (p: Vec3) => p.map((v) => Math.round(v * 10)).join(',');
  const ends = new Map<string, { p: Vec3; here: { r: Resolved; end: 'a' | 'b' }[] }>();
  for (const r of list) {
    for (const end of ['a', 'b'] as const) {
      const p = end === 'a' ? r.from : r.to;
      const k = key(p);
      const e = ends.get(k) ?? { p, here: [] };
      e.here.push({ r, end });
      ends.set(k, e);
    }
  }
  const adjust = new Map<Resolved, { a: number; b: number }>(list.map((r) => [r, { a: 0, b: 0 }]));
  const axesOf = (r: Resolved) => sectionAxes(r.dir);
  const rank = (r: Resolved) => (isVertical(r.dir) ? 1e6 : 0) + sectionSize(r.m) * 10 - list.indexOf(r) * 1e-3;
  // A member lying on the ground level sits on the ground instead of half below it
  const lift = new Map<Resolved, number>(
    list.map((r) => {
      const lying = !isVertical(r.dir) && Math.abs(r.from[1]) < 0.5 && Math.abs(r.to[1]) < 0.5;
      const { f, n } = axesOf(r);
      return [r, lying ? halfExtent(r.m, f, n, UP) : 0];
    }),
  );

  for (const { p, here } of ends.values()) {
    const ground = Math.abs(p[1]) < 0.5;
    // Members this point lies on, between their ends
    const passing = list.filter((r) => {
      if (here.some((h) => h.r === r)) return false;
      const t = dot(sub(p, r.from), r.dir);
      const L = len(sub(r.to, r.from));
      return t > 1 && t < L - 1 && len(sub(p, add(r.from, scale(r.dir, t)))) < 0.5;
    });
    if (!passing.length && here.length < 2) continue;
    const through = passing.length ? passing.sort((a, b) => rank(b) - rank(a))[0] : [...here].sort((a, b) => rank(b.r) - rank(a.r))[0].r;
    let extend = 0;
    for (const { r, end } of here) {
      if (r === through || parallel(r.dir, through.dir)) continue;
      const { f, n } = axesOf(through);
      // A post standing on a member lying on the ground starts on its top face
      const lifted = ground && isVertical(r.dir) ? (lift.get(through) ?? 0) : 0;
      (adjust.get(r) as { a: number; b: number })[end] += halfExtent(through.m, f, n, r.dir) + lifted;
      const own = axesOf(r);
      extend = Math.max(extend, halfExtent(r.m, own.f, own.n, through.dir));
    }
    const mine = here.find((h) => h.r === through);
    // A post never runs on below the ground: the members it carries there are lifted onto the ground instead
    const intoGround = ground && isVertical(through.dir);
    if (mine && extend > 0 && !intoGround) (adjust.get(through) as { a: number; b: number })[mine.end] -= extend;
  }

  return list.map((r) => {
    const adj = { ...(adjust.get(r) as { a: number; b: number }) };
    const up = scale(UP, lift.get(r) ?? 0);
    let plate: Plate | undefined;
    // On a base plate the member starts on top of the plate: on the ground, or on a free end above it (a slab)
    const base = r.m.base;
    if (base && isVertical(r.dir)) {
      const low = r.from[1] <= r.to[1] ? 'a' : 'b';
      const foot = low === 'a' ? r.from : r.to;
      const onGround = Math.abs(foot[1]) < 0.5;
      if ((onGround && adj[low] <= base.t + 0.5) || (!onGround && adj[low] === 0)) {
        adj[low] = Math.max(adj[low], base.t);
        plate = { id: `${r.m.id}-base`, center: [foot[0], foot[1] + base.t / 2, foot[2]], size: [base.w, base.d], normal: 'y', thickness: base.t, label: 'פלטת בסיס' };
      }
    }
    return { ...r, plate, from: add(add(r.from, scale(r.dir, adj.a)), up), to: add(sub(r.to, scale(r.dir, adj.b)), up) };
  });
}

/** The bars of an infill between two resolved members: first bar, how many, and the step between them */
function infillBars(fill: FrameInfill, p: Resolved, q: Resolved): Member | null {
  if (!parallel(p.dir, q.dir)) return null;
  const dP = p.dir;
  const L = len(sub(p.to, p.from));
  const tq = [dot(sub(q.from, p.from), dP), dot(sub(q.to, p.from), dP)];
  const start = Math.max(0, Math.min(...tq));
  const end = Math.min(L, Math.max(...tq));
  const span = end - start;
  if (span < 50) return null;
  const w = sub(q.from, p.from);
  const v = sub(w, scale(dP, dot(w, dP)));
  if (len(v) < 10) return null;
  const vn = norm(v);
  const bar = { profile: fill.profile, size: fill.size };
  const barAxes = sectionAxes(vn);
  const wbar = 2 * halfExtent(bar, barAxes.f, barAxes.n, dP);
  const n = Math.max(0, Math.ceil((span - fill.gap) / (wbar + fill.gap) - 1e-9));
  if (n === 0) return null;
  const g = (span - n * wbar) / (n + 1);
  const pAx = sectionAxes(p.dir);
  const qAx = sectionAxes(q.dir);
  const base = add(p.from, scale(dP, start + g + wbar / 2));
  const from = add(base, scale(vn, halfExtent(p.m, pAx.f, pAx.n, vn)));
  const to = sub(add(base, v), scale(vn, halfExtent(q.m, qAx.f, qAx.n, vn)));
  if (dot(sub(to, from), vn) < 10) return null;
  return {
    id: fill.id,
    profile: fill.profile,
    size: fill.size,
    from,
    to,
    label: fill.label ?? 'מילוי',
    ...(n > 1 ? { repeat: { count: n, step: scale(dP, g + wbar) } } : {}),
  };
}

/** The layout the rest of the app draws, prices and cuts, with the design inside it */
export function compileDesign(design: Design, title: string): Record<string, unknown> {
  const c = collect(design);
  const resolved = resolveJoints(c.frames);
  const members: Member[] = resolved.map((r) => ({
    id: r.m.id,
    profile: r.m.profile,
    size: r.m.size,
    from: r.from,
    to: r.to,
    ...(r.m.label ? { label: r.m.label } : {}),
    ...(r.m.roll ? { roll: r.m.roll } : {}),
  }));
  const byId = new Map(resolved.map((r) => [r.m.id, r]));
  for (const f of c.infills) {
    const p = byId.get(f.between[0]);
    const q = byId.get(f.between[1]);
    const bars = p && q ? infillBars(f, p, q) : null;
    if (bars) members.push(bars);
  }
  members.push(...c.members);
  const plates: Plate[] = [...resolved.flatMap((r) => (r.plate ? [r.plate] : [])), ...c.plates];

  // Grid chains: bays along the top, levels down the left (the drawing measures the overall size itself)
  const { grid } = design;
  const xs = gridLines(grid.x);
  const ys = gridLines(grid.y);
  const top = ys[ys.length - 1];
  const front = gridLines(grid.z).at(-1) ?? 0;
  const dimensions: Dimension[] = [];
  if (grid.x.length > 1) for (let i = 0; i < grid.x.length; i++) dimensions.push({ from: [xs.at(i) ?? 0, top, front], to: [xs.at(i + 1) ?? 0, top, front] });
  if (grid.y.length > 1) for (let j = 0; j < grid.y.length; j++) dimensions.push({ from: [0, ys.at(j) ?? 0, front], to: [0, ys.at(j + 1) ?? 0, front] });

  return {
    version: 1,
    title,
    material: design.material,
    members,
    plates,
    ...(c.parts.length ? { parts: c.parts } : {}),
    dimensions,
    ...(c.notes.length ? { notes: c.notes } : {}),
    design,
  };
}

/** What a block's sheet shows: a few lines about it, and a warning when something looks off */
export function blockReport(design: Design, id: string): { info: string[]; warn: string | null } {
  return collect(design).reports.get(id) ?? { info: [], warn: null };
}

// -------------------------------------------------------------------------------------------- edits

let counter = 0;
const newId = (prefix: string, taken: Set<string>) => {
  let id = '';
  do id = `${prefix}${++counter}`;
  while (taken.has(id));
  return id;
};

export function addMember(design: Design, a: DesignNode, b: DesignNode, choice: ProfileChoice): { design: Design; id: string | null } {
  if (sameNode(a, b)) return { design, id: null };
  const exists = design.members.some((m) => (sameNode(m.a, a) && sameNode(m.b, b)) || (sameNode(m.a, b) && sameNode(m.b, a)));
  if (exists) return { design, id: null };
  const id = newId('m', new Set(design.members.map((m) => m.id)));
  return { design: { ...design, members: [...design.members, { id, a, b, profile: choice.profile, size: choice.size }] }, id };
}

export function updateMember(design: Design, id: string, patch: Partial<Omit<DesignMember, 'id' | 'a' | 'b'>>): Design {
  return { ...design, members: design.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

/** Removes a member and any infill hanging on it */
export function removeMember(design: Design, id: string): Design {
  return {
    ...design,
    members: design.members.filter((m) => m.id !== id),
    infills: design.infills.filter((f) => !f.between.includes(id)),
  };
}

export function addInfill(design: Design, between: [string, string], choice: ProfileChoice, gap: number): { design: Design; id: string } {
  const id = newId('f', new Set(design.infills.map((f) => f.id)));
  return { design: { ...design, infills: [...design.infills, { id, between, profile: choice.profile, size: choice.size, gap }] }, id };
}

export function updateInfill(design: Design, id: string, patch: Partial<Omit<DesignInfill, 'id' | 'between'>>): Design {
  return { ...design, infills: design.infills.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function removeInfill(design: Design, id: string): Design {
  return { ...design, infills: design.infills.filter((f) => f.id !== id) };
}

/** A block between two grid points, with its default numbers; null id when the points can't hold it */
export function addBlock(design: Design, kind: BlockKind, a: DesignNode, b: DesignNode, set: Record<string, number> = {}): { design: Design; id: string | null } {
  if (placementError(kind, a, b)) return { design, id: null };
  const id = newId('b', new Set(design.blocks.map((k) => k.id)));
  return { design: { ...design, blocks: [...design.blocks, newBlock(kind, id, a, b, set)] }, id };
}

export function updateBlock(design: Design, id: string, patch: { params?: Record<string, number>; profiles?: Record<string, ProfileChoice> }): Design {
  return {
    ...design,
    blocks: design.blocks.map((k) => (k.id === id ? { ...k, params: { ...k.params, ...patch.params }, profiles: { ...k.profiles, ...patch.profiles } } : k)),
  };
}

export function removeBlock(design: Design, id: string): Design {
  return { ...design, blocks: design.blocks.filter((k) => k.id !== id) };
}

export function setSpacing(design: Design, axis: GridAxis, index: number, value: number): Design {
  if (!(value > 0) || index < 0 || index >= design.grid[axis].length) return design;
  const list = design.grid[axis].map((s, i) => (i === index ? Math.round(value) : s));
  return { ...design, grid: { ...design.grid, [axis]: list } };
}

/** Adds a bay at the end of an axis (same as the last one, or 1,000 for the first depth bay) */
export function addBay(design: Design, axis: GridAxis): Design {
  const list = design.grid[axis];
  if (list.length >= 40) return design;
  return { ...design, grid: { ...design.grid, [axis]: [...list, list.at(-1) ?? 1000] } };
}

const AXIS_INDEX: Record<GridAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/**
 * A grid line at `pos` (mm from the first line) along an axis: the one already there (within half a millimetre),
 * or a new one that splits a bay, extends the grid past its last line, or (along X and Z) starts it earlier.
 * Everything already drawn keeps its place: node indices past the new line move up by one.
 * Returns the line's index. Levels never go below the ground.
 */
export function insertGridLine(design: Design, axis: GridAxis, pos: number): { design: Design; index: number } {
  const i = AXIS_INDEX[axis];
  const spacings = design.grid[axis];
  const lines = gridLines(spacings);
  const at = Math.round(axis === 'y' ? Math.max(0, pos) : pos);
  const found = lines.findIndex((l) => Math.abs(l - at) <= 0.5);
  if (found >= 0) return { design, index: found };
  if (spacings.length >= 40) return { design, index: lines.reduce((best, l, k) => (Math.abs(l - at) < Math.abs((lines[best] ?? 0) - at) ? k : best), 0) };

  let list: number[];
  let index: number;
  let shiftFrom: number; // node indices >= this move up by one
  const last = lines[lines.length - 1];
  if (at > last) {
    list = [...spacings, at - last];
    index = lines.length;
    shiftFrom = Number.POSITIVE_INFINITY;
  } else if (at < 0) {
    list = [-at, ...spacings];
    index = 0;
    shiftFrom = 0;
  } else {
    const bay = lines.findIndex((l, k) => k < lines.length - 1 && l < at && at < lines[k + 1]);
    list = [...spacings.slice(0, bay), at - lines[bay], lines[bay + 1] - at, ...spacings.slice(bay + 1)];
    index = bay + 1;
    shiftFrom = bay + 1;
  }
  const move = (n: DesignNode): DesignNode => {
    if (n[i] < shiftFrom) return n;
    const out: DesignNode = [n[0], n[1], n[2]];
    out[i] += 1;
    return out;
  };
  return {
    design: {
      ...design,
      grid: { ...design.grid, [axis]: list },
      members: design.members.map((m) => ({ ...m, a: move(m.a), b: move(m.b) })),
      blocks: design.blocks.map((k) => ({ ...k, a: move(k.a), b: move(k.b) })),
    },
    index,
  };
}

/** Removes the last bay of an axis; members and blocks on its far line go too. Returns how many were removed. */
export function removeLastBay(design: Design, axis: GridAxis): { design: Design; removed: number } {
  const list = design.grid[axis];
  if (list.length === 0 || (axis !== 'z' && list.length === 1)) return { design, removed: 0 };
  const last = list.length;
  const i = AXIS_INDEX[axis];
  const onLast = (k: { a: DesignNode; b: DesignNode }) => k.a[i] === last || k.b[i] === last;
  const gone = design.members.filter(onLast).map((m) => m.id);
  const blocks = design.blocks.filter((k) => !onLast(k));
  let next: Design = { ...design, blocks, grid: { ...design.grid, [axis]: list.slice(0, -1) } };
  for (const id of gone) next = removeMember(next, id);
  return { design: next, removed: gone.length + design.blocks.length - blocks.length };
}

/** The member's cut length once its ends are trimmed at the joints */
export function memberCutLengths(design: Design): Map<string, number> {
  return new Map(resolveJoints(collect(design).frames).map((r) => [r.m.id, Math.round(len(sub(r.to, r.from)))]));
}

/** Labels for grid lines: A, B, C… along X; 1, 2, 3… along Z; levels by height */
export const xLineName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `X${i + 1}`);
export const zLineName = (i: number) => String(i + 1);
