/**
 * A design built by hand, without AI: a grid of typed spacings, members between grid points, base plates, infill
 * bars and plates (sheets between grid lines). It compiles to the same layout JSON (scene.ts) the 3D viewer, shop drawing and cut list use, and
 * travels inside that layout as `design`, so the builder can open it again.
 *
 * Grid: spacings along X (left to right), Y (levels, from the ground up) and Z (back to front, towards the
 * street), each in mm. A node is [xi, yi, zi], indices of grid lines (0 = the first line).
 */
import type { MaterialKey } from './catalog.ts';
import { beamSizes } from './sections.ts';
import { PROFILES, SLOPE_UPS, add, dot, halfExtent, len, norm, scale, sectionAxes, sub } from './scene.ts';
import type { Dimension, Member, Part, Plate, Profile, SlopeUp, Vec3 } from './scene.ts';
import { BLOCK_KINDS, buildBlock, newBlock, placementError } from './blocks.ts';
import type { BlockKind, DesignBlock, Frame, FrameInfill } from './blocks.ts';
import { isSheet, isTint, purlinGap, sheetCount, sheetInfo, sheetTint } from './sheets.ts';
import type { SheetKey, SheetTint } from './sheets.ts';

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
  /** Degrees about its own axis, as in the layout (a 60/40 tube turned on its side); from a converted AI model */
  roll?: number;
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

/**
 * Where a plate sits against the parts around its edges: on their face (a sheet welded over the frame, the size of
 * the frame's outside), inside them (a panel between them), or centred on the grid lines (a sheet on its own).
 */
export type PlateFit = 'face' | 'inside' | 'center';
export const PLATE_FITS: readonly PlateFit[] = ['face', 'inside', 'center'];

export interface DesignPlate {
  id: string;
  /** Two opposite corners of the plate, on one grid plane (one index the same in both) */
  a: DesignNode;
  b: DesignNode;
  thickness: number;
  fit: PlateFit;
  /** On the face: which face, along the plane's axis (+1 = up, to the street, to the right) */
  side: 1 | -1;
  label?: string;
  /** A roofing sheet (סנטף, polycarbonate) instead of steel; then `thickness` is not used */
  sheet?: SheetKey;
  tint?: SheetTint;
  /**
   * A level plate tilted (a sloped roof): its low edge stays on its grid level, on the side away from `up`, and it rises
   * `deg` degrees toward `up`, lying on the frame pieces that slope with it
   */
  slope?: { up: SlopeUp; deg: number };
}

export interface Design {
  version: 1;
  grid: DesignGrid;
  members: DesignMember[];
  infills: DesignInfill[];
  plates: DesignPlate[];
  /** Stairs, platforms, railings, ladders and gates (blocks.ts) */
  blocks: DesignBlock[];
  material: MaterialKey;
  /**
   * Spacings drawn by eye and not measured yet (true), per axis, in step with `grid`. Absent when everything is
   * measured. The first measurement typed into a design that is all guesses scales the whole of it.
   */
  guess?: Partial<Record<GridAxis, boolean[]>>;
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

/**
 * What each number of a size is, to type them one per field (a phone's number pad has no "/"). The depth of a
 * tube and the second leg of an angle may stay empty: the same as the first.
 */
export const SIZE_FIELDS: Record<Profile, string[]> = {
  rect_tube: ['רוחב', 'עומק', 'דופן'],
  angle: ['צלע', 'צלע שנייה', 'עובי'],
  flat: ['רוחב', 'עובי'],
  round_tube: ['קוטר', 'דופן'],
  round_bar: ['קוטר'],
  square_bar: ['צלע'],
  ipe: ['גובה'],
  hea: ['גובה'],
  upn: ['גובה'],
};

/** A size typed one number per field (SIZE_FIELDS), or null; a decimal comma counts as a point */
export function sizeFromFields(profile: Profile, fields: string[]): number[] | null {
  const parts = fields.map((f) => f.trim().replace(',', '.'));
  if (parts.some((f) => f !== '' && !/^\d+(\.\d+)?$/.test(f))) return null;
  // A square tube or an equal angle: the second number may stay empty
  const filled = (profile === 'rect_tube' || profile === 'angle') && parts[1] === '' ? [parts[0], parts[2] ?? ''] : parts;
  if (filled.some((f) => f === '')) return null;
  return parseSize(profile, filled.join('/'));
}

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
  return { version: 1, grid: { x: [2000], y: [2000], z: [] }, members: [], infills: [], plates: [], blocks: [], material };
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
    const { roll, ...rest } = m;
    members.push({ ...rest, a, b, ...(isNum(roll) && roll % 360 !== 0 ? { roll } : {}) });
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
  const plates: DesignPlate[] = [];
  for (const raw of Array.isArray(d.plates) ? (d.plates as unknown[]) : []) {
    const q = raw as Partial<DesignPlate> | null;
    const a = nodeOf(q?.a);
    const b = nodeOf(q?.b);
    const sheet = isSheet(q?.sheet) ? q.sheet : undefined;
    if (!q || !a || !b || typeof q.id !== 'string' || plateError(a, b)) continue;
    if (!sheet && !(isNum(q.thickness) && q.thickness > 0)) continue;
    plates.push({
      id: q.id,
      a,
      b,
      thickness: isNum(q.thickness) && q.thickness > 0 ? q.thickness : 3,
      fit: PLATE_FITS.includes(q.fit as PlateFit) ? (q.fit as PlateFit) : 'face',
      side: q.side === -1 ? -1 : 1,
      ...(typeof q.label === 'string' && q.label ? { label: q.label } : {}),
      ...(sheet ? { sheet, tint: sheetTint(sheet, isTint(q.tint) ? q.tint : null) } : {}),
      ...(a[1] === b[1] && q.slope && SLOPE_UPS.includes(q.slope.up) && isNum(q.slope.deg) && q.slope.deg > 0 && q.slope.deg <= 60
        ? { slope: { up: q.slope.up, deg: q.slope.deg } }
        : {}),
    });
  }
  const read: Design = { version: 1, grid: { x, y, z }, members, infills, plates, blocks, material: (d.material as MaterialKey) ?? 'black' };
  let out = read;
  for (const axis of AXES) {
    const flags = (d.guess as Record<string, unknown> | undefined)?.[axis];
    if (Array.isArray(flags) && flags.length === read.grid[axis].length && flags.every((f) => typeof f === 'boolean')) out = withGuess(out, axis, flags);
  }
  return out;
}

// ------------------------------------------------------------------------------------------- guesses

const AXES: GridAxis[] = ['x', 'y', 'z'];

/** Which spacings along an axis are still guesses (one flag per spacing) */
export function guesses(design: Design, axis: GridAxis): boolean[] {
  const flags = design.guess?.[axis];
  return design.grid[axis].map((_, i) => flags?.[i] === true);
}

/** The design with an axis's guess flags replaced; `guess` is dropped once nothing is a guess */
function withGuess(design: Design, axis: GridAxis, flags: boolean[]): Design {
  const next: Partial<Record<GridAxis, boolean[]>> = { ...design.guess, [axis]: flags };
  const kept = Object.fromEntries(AXES.filter((a) => next[a]?.some(Boolean)).map((a) => [a, next[a] as boolean[]]));
  const rest: Design = { ...design };
  delete rest.guess;
  return Object.keys(kept).length ? { ...rest, guess: kept } : rest;
}

/** Every spacing marked as a guess (a sketch drawn by eye, before any measurement) */
export function allGuesses(design: Design): Design {
  let d = design;
  for (const axis of AXES) d = withGuess(d, axis, design.grid[axis].map(() => true));
  return d;
}

/** How many spacings are still guesses */
export function guessCount(design: Design): number {
  return AXES.reduce((n, axis) => n + guesses(design, axis).filter(Boolean).length, 0);
}

/** Nothing measured yet: there are spacings and every one of them is a guess */
export function allGuessed(design: Design): boolean {
  const total = AXES.reduce((n, axis) => n + design.grid[axis].length, 0);
  return total > 0 && guessCount(design) === total;
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
    .map((m) => ({ id: m.id, profile: m.profile, size: m.size, from: nodePosition(grid, m.a), to: nodePosition(grid, m.b), label: m.label, base: m.base ?? null, ...(m.roll ? { roll: m.roll } : {}) }));
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

/** Why two grid points can't be the corners of a plate, or null */
export function plateError(a: DesignNode, b: DesignNode): string | null {
  const same = ([0, 1, 2] as const).filter((i) => a[i] === b[i]).length;
  if (same === 3) return 'גע בשתי פינות שונות.';
  if (same === 2) return 'פח הוא מלבן: גע בשתי פינות נגדיות, לא על אותו קו.';
  if (same === 0) return 'שתי הפינות צריכות להיות באותו מבט.';
  return null;
}

const AXIS_NAMES = ['x', 'y', 'z'] as const;
const unitAlong = (i: number): Vec3 => {
  const v: Vec3 = [0, 0, 0];
  v[i] = 1;
  return v;
};

/**
 * A plate as the layout draws it: the rectangle between its two grid corners, grown to the outside of the frame
 * pieces on its edges (on their face, and moved out to that face), shrunk to their inside, or left on the grid
 * lines. Frame pieces lying on the ground sit on it, and so does a plate on them.
 */
function platePiece(p: DesignPlate, grid: DesignGrid, frames: Frame[]): Plate | null {
  const sheet = p.sheet ? sheetInfo(p.sheet) : null;
  if (!nodeInGrid(grid, p.a) || !nodeInGrid(grid, p.b) || plateError(p.a, p.b) || !(sheet || p.thickness > 0)) return null;
  if (p.slope && p.a[1] === p.b[1]) return slopedPiece(p, grid, frames);
  const A = nodePosition(grid, p.a);
  const B = nodePosition(grid, p.b);
  const k = ([0, 1, 2] as const).find((x) => p.a[x] === p.b[x]) ?? 2;
  const [i, j] = ([0, 1, 2] as const).filter((x) => x !== k);
  const w = A[k];
  const lo: Vec3 = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.min(A[2], B[2])];
  const hi: Vec3 = [Math.max(A[0], B[0]), Math.max(A[1], B[1]), Math.max(A[2], B[2])];
  const near = (u: number, v: number) => Math.abs(u - v) < 0.5;
  // Frame pieces lying along an edge of the rectangle, in its plane
  const along = (fixed: number, value: number, run: number) =>
    frames.filter((f) => {
      if (!near(f.from[k], w) || !near(f.to[k], w) || !near(f.from[fixed], value) || !near(f.to[fixed], value)) return false;
      return Math.min(Math.max(f.from[run], f.to[run]), hi[run]) - Math.max(Math.min(f.from[run], f.to[run]), lo[run]) > 1;
    });
  const reach = (list: Frame[], dir: Vec3) =>
    list.reduce((most, f) => {
      const axes = sectionAxes(norm(sub(f.to, f.from)));
      return Math.max(most, halfExtent(f, axes.f, axes.n, dir));
    }, 0);
  const edges: [number, 'lo' | 'hi', Frame[]][] = [
    [i, 'lo', along(i, lo[i], j)],
    [i, 'hi', along(i, hi[i], j)],
    [j, 'lo', along(j, lo[j], i)],
    [j, 'hi', along(j, hi[j], i)],
  ];
  const grow = p.fit === 'face' ? 1 : p.fit === 'inside' ? -1 : 0;
  for (const [x, end, list] of edges) {
    const e = reach(list, unitAlong(x));
    if (end === 'lo') lo[x] -= grow * e;
    else hi[x] += grow * e;
    // A piece lying on the ground sits on it: the plate's edge on it moves up with it
    if (x === 1 && end === 'lo' && near(lo[1] + grow * e, 0) && list.length) lo[1] += reach(list, UP);
  }
  if (lo[1] < 0) lo[1] = 0;
  if (hi[i] - lo[i] < 1 || hi[j] - lo[j] < 1) return null;
  const all = edges.flatMap(([, , list]) => list);
  const depth = reach(all, unitAlong(k));
  // A sheet takes the room of its profile (the wave, or the cells)
  const t = sheet ? sheet.depth : p.thickness;
  let c = w + (k === 1 && near(w, 0) ? depth : 0) + (p.fit === 'face' ? p.side * (depth + t / 2) : 0);
  if (k === 1 && c - t / 2 < 0) c = t / 2;
  const center: Vec3 = [0, 0, 0];
  center[i] = (lo[i] + hi[i]) / 2;
  center[j] = (lo[j] + hi[j]) / 2;
  center[k] = c;
  const ext = (x: number) => hi[x] - lo[x];
  const size: [number, number] = k === 2 ? [ext(0), ext(1)] : k === 0 ? [ext(2), ext(1)] : [ext(0), ext(2)];
  if (sheet && p.sheet) {
    const tint = sheetTint(p.sheet, p.tint);
    return { id: p.id, center, size, normal: AXIS_NAMES[k], thickness: t, sheet: p.sheet, tint, label: p.label ?? sheet.short };
  }
  return { id: p.id, center, size, normal: AXIS_NAMES[k], thickness: t, label: p.label ?? 'פח' };
}

/** A sloped plate's plane: the axis it rises along, which way, its low edge, and the height of its grid line at u */
function slopePlane(p: DesignPlate, grid: DesignGrid) {
  const A = nodePosition(grid, p.a);
  const B = nodePosition(grid, p.b);
  const up = p.slope?.up ?? '+z';
  const s = up[1] === 'x' ? 0 : 2;
  const c = s === 0 ? 2 : 0;
  const sg = up[0] === '+' ? 1 : -1;
  const lo = (x: number) => Math.min(A[x], B[x]);
  const hi = (x: number) => Math.max(A[x], B[x]);
  const low = sg > 0 ? lo(s) : hi(s);
  const tan = Math.tan(((p.slope?.deg ?? 0) * Math.PI) / 180);
  const height = (u: number) => A[1] + tan * sg * (u - low);
  // A frame piece lies on the plane when both its ends do (a rafter, or a purlin across it)
  const onPlane = (f: Frame) => Math.abs(f.from[1] - height(f.from[s])) < 2 && Math.abs(f.to[1] - height(f.to[s])) < 2;
  return { A, B, s, c, sg, lo, hi, low, tan, height, onPlane };
}

/**
 * A sloped plate (a roof): the rectangle between its corners seen from above, grown to the outside of the frame pieces
 * on its edges (beams across, rafters along the slope) like a level one, then tilted to lie on them.
 */
function slopedPiece(p: DesignPlate, grid: DesignGrid, frames: Frame[]): Plate | null {
  if (!p.slope) return null;
  const sheet = p.sheet ? sheetInfo(p.sheet) : null;
  const P = slopePlane(p, grid);
  const { s, c } = P;
  const lo: Vec3 = [P.lo(0), P.lo(1), P.lo(2)];
  const hi: Vec3 = [P.hi(0), P.hi(1), P.hi(2)];
  const near = (u: number, v: number) => Math.abs(u - v) < 0.5;
  const along = (fixed: number, value: number, run: number) =>
    frames.filter((f) => {
      if (!P.onPlane(f) || !near(f.from[fixed], value) || !near(f.to[fixed], value)) return false;
      return Math.min(Math.max(f.from[run], f.to[run]), hi[run]) - Math.max(Math.min(f.from[run], f.to[run]), lo[run]) > 1;
    });
  const reach = (list: Frame[], dir: Vec3) =>
    list.reduce((most, f) => {
      const axes = sectionAxes(norm(sub(f.to, f.from)));
      return Math.max(most, halfExtent(f, axes.f, axes.n, dir));
    }, 0);
  const edges: [number, 'lo' | 'hi', Frame[]][] = [
    [s, 'lo', along(s, lo[s], c)],
    [s, 'hi', along(s, hi[s], c)],
    [c, 'lo', along(c, lo[c], s)],
    [c, 'hi', along(c, hi[c], s)],
  ];
  const grow = p.fit === 'face' ? 1 : p.fit === 'inside' ? -1 : 0;
  for (const [x, end, list] of edges) {
    const e = reach(list, unitAlong(x));
    if (end === 'lo') lo[x] -= grow * e;
    else hi[x] += grow * e;
  }
  if (hi[s] - lo[s] < 1 || hi[c] - lo[c] < 1) return null;
  // How far the frame's top is above its lines: the beams across the slope, else the rafters
  const across = [...edges[0][2], ...edges[1][2]];
  const depth = reach(across.length ? across : edges.flatMap(([, , l]) => l), UP);
  const t = sheet ? sheet.depth : p.thickness;
  const cos = Math.cos((p.slope.deg * Math.PI) / 180);
  const mid: Vec3 = [0, 0, 0];
  mid[s] = (lo[s] + hi[s]) / 2;
  mid[c] = (lo[c] + hi[c]) / 2;
  mid[1] = P.height(mid[s]) + (p.fit === 'face' ? p.side * (depth + t / 2 / cos) : 0);
  const run = (hi[s] - lo[s]) / cos;
  const size: [number, number] = s === 0 ? [run, hi[c] - lo[c]] : [hi[c] - lo[c], run];
  const base = { id: p.id, center: mid, size, normal: 'y' as const, slope: { up: p.slope.up, deg: p.slope.deg }, thickness: t };
  if (sheet && p.sheet) return { ...base, sheet: p.sheet, tint: sheetTint(p.sheet, p.tint), label: p.label ?? sheet.short };
  return { ...base, label: p.label ?? 'פח' };
}

/**
 * Where the frame holds a sheet: the positions, across each of the plate's two in-plane axes, of the frame pieces in
 * its plane that run the other way through its rectangle. A sheet spans between them one way or the other. On a
 * sloped plate, positions down the slope are measured along it.
 */
function supportsUnder(p: DesignPlate, grid: DesignGrid, frames: Frame[]): [number[], number[]] {
  const A = nodePosition(grid, p.a);
  const B = nodePosition(grid, p.b);
  const k = ([0, 1, 2] as const).find((x) => p.a[x] === p.b[x]) ?? 2;
  const [i, j] = ([0, 1, 2] as const).filter((x) => x !== k);
  const lo = (x: number) => Math.min(A[x], B[x]);
  const hi = (x: number) => Math.max(A[x], B[x]);
  const near = (u: number, v: number) => Math.abs(u - v) < 0.5;
  const sloped = p.slope && k === 1 ? slopePlane(p, grid) : null;
  const inPlane = (f: Frame) => (sloped ? sloped.onPlane(f) : near(f.from[k], A[k]) && near(f.to[k], A[k]));
  const along = (across: number, at: number) => (sloped && across === sloped.s ? Math.abs(at - sloped.low) * Math.sqrt(1 + sloped.tan ** 2) : at);
  const positions = (across: number, run: number) =>
    frames
      .filter((f) => inPlane(f) && near(f.from[across], f.to[across]))
      .filter((f) => f.from[across] > lo(across) - 0.5 && f.from[across] < hi(across) + 0.5)
      .filter((f) => Math.min(Math.max(f.from[run], f.to[run]), hi(run)) - Math.max(Math.min(f.from[run], f.to[run]), lo(run)) > 1)
      .map((f) => along(across, f.from[across]));
  return [positions(i, j), positions(j, i)];
}

/**
 * The slope that lays a level plate on the frame around it: rafters from its edge on its level to the opposite edge
 * (or, failing those, the beam along the opposite edge) give the rise. A plate drawn on the high side moves down to the
 * low one. `rafters` keeps to rafters only (what placing a plate does by itself). Null when nothing slopes.
 */
export function fitSlope(design: Design, id: string, opts: { rafters?: boolean } = {}): Design | null {
  const plate = design.plates.find((p) => p.id === id);
  if (!plate || plate.a[1] !== plate.b[1]) return null;
  const { frames } = collect(design);
  const A = nodePosition(design.grid, plate.a);
  const B = nodePosition(design.grid, plate.b);
  const w = A[1];
  const near = (u: number, v: number) => Math.abs(u - v) < 0.5;
  const levels = gridLines(design.grid.y);
  type Found = { up: SlopeUp; rise: number; run: number; rafter: boolean };
  const found: Found[] = [];
  for (const up of SLOPE_UPS) {
    const s = up[1] === 'x' ? 0 : 2;
    const c = s === 0 ? 2 : 0;
    const sg = up[0] === '+' ? 1 : -1;
    const [lo, hi] = [Math.min(A[s], B[s]), Math.max(A[s], B[s])];
    const [N, F] = sg > 0 ? [lo, hi] : [hi, lo];
    const run = Math.abs(F - N);
    const inSpan = (v: number) => v > Math.min(A[c], B[c]) - 0.5 && v < Math.max(A[c], B[c]) + 0.5;
    for (const f of frames) {
      for (const [p, q] of [
        [f.from, f.to],
        [f.to, f.from],
      ] as const) {
        if (!near(p[s], N) || !near(q[s], F) || !near(p[1], w) || near(q[1], w) || !near(p[c], q[c]) || !inSpan(p[c])) continue;
        found.push({ up, rise: q[1] - w, run, rafter: true });
      }
    }
    if (opts.rafters) continue;
    // A beam along the far edge, higher up
    const beams = frames.filter((f) => near(f.from[s], F) && near(f.to[s], F) && near(f.from[1], f.to[1]) && f.from[1] > w + 0.5 && (inSpan(f.from[c]) || inSpan(f.to[c])));
    if (beams.length) found.push({ up, rise: Math.min(...beams.map((f) => f.from[1])) - w, run, rafter: false });
  }
  const best = found.find((f) => f.rafter && f.rise > 0) ?? found.find((f) => f.rafter) ?? found.find((f) => f.rise > 0);
  if (!best || !(best.run > 0)) return null;
  const deg = Math.round(((Math.atan(Math.abs(best.rise) / best.run) * 180) / Math.PI) * 10) / 10;
  if (!(deg > 0 && deg <= 60)) return null;
  let a = plate.a;
  let b = plate.b;
  let up = best.up;
  if (best.rise < 0) {
    // Drawn on the high side: down to the low level, rising back toward where it was
    const idx = levels.findIndex((y) => near(y, w + best.rise));
    if (idx < 0) return null;
    a = [a[0], idx, a[2]];
    b = [b[0], idx, b[2]];
    up = `${up[0] === '+' ? '-' : '+'}${up[1]}` as SlopeUp;
  }
  return { ...design, plates: design.plates.map((p) => (p.id === id ? { ...p, a, b, slope: { up, deg } } : p)) };
}

/** What a sheet's editor shows: its size and weight, how many sheets, the maker's spans, and a warning */
export function plateReport(design: Design, id: string): { info: string[]; warn: string | null } {
  const plate = design.plates.find((p) => p.id === id);
  const c = collect(design);
  const piece = plate ? platePiece(plate, design.grid, c.frames) : null;
  if (!plate || !piece) return { info: [], warn: null };
  const [w, h] = [Math.max(...piece.size), Math.min(...piece.size)];
  const area = (w * h) / 1e6;
  const fmt = (n: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(n);
  // A sloped one: how much higher its high edge stands
  const slopeLine = plate.slope
    ? (() => {
        const P = slopePlane(plate, design.grid);
        const rise = Math.round((P.hi(P.s) - P.lo(P.s)) * P.tan);
        return `שיפוע ${fmt(plate.slope.deg)} מעלות: הצד הגבוה גבוה ב־${fmt(rise)} מ״מ`;
      })()
    : null;
  if (!plate.sheet) {
    const info = [`${fmt(Math.round(w))}/${fmt(Math.round(h))} מ״מ, בערך ${fmt(Math.round(area * plate.thickness * 7.85))} ק״ג`];
    return { info: slopeLine ? [...info, slopeLine] : info, warn: null };
  }
  const def = sheetInfo(plate.sheet);
  if (!def) return { info: [], warn: null };
  const info = [`${fmt(Math.round(w))}/${fmt(Math.round(h))} מ״מ, ${fmt(Math.round(area * 100) / 100)} מ״ר, בערך ${fmt(Math.round(area * def.kgPerM2))} ק״ג`];
  if (slopeLine) info.push(slopeLine);
  const n = sheetCount(plate.sheet, w);
  if (n && def.width) info.push(`בערך ${n} ${n === 1 ? 'לוח' : 'לוחות'} ברוחב ${fmt(def.width)}, באורך ${fmt(Math.round(h))}`);
  if (def.purlin) info.push(`מרישים כל ${fmt(def.purlin.mid)} מ״מ לכל היותר, ${fmt(def.purlin.end)} בקצוות`);
  if (def.minPitch && !plate.slope) info.push(`שיפוע ${def.minPitch} מעלות לפחות, שהמים יתנקזו`);
  let warn: string | null = null;
  if (def.minPitch && plate.slope && plate.slope.deg < def.minPitch) warn = `שיפוע ${fmt(plate.slope.deg)} מעלות קטן מדי: ל${def.short} צריך ${def.minPitch} לפחות, שהמים יתנקזו.`;
  if (def.purlin) {
    const checks = supportsUnder(plate, design.grid, c.frames)
      .map((at) => purlinGap(plate.sheet as SheetKey, at))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (!warn && checks.length > 0 && !checks.some((x) => x.ok)) {
      const best = checks.reduce((a, b) => (a.gap - a.limit <= b.gap - b.limit ? a : b));
      warn = `יש מרווח של ${fmt(best.gap)} מ״מ בין המרישים, והמותר ל${def.short} הוא ${fmt(best.limit)}. כדאי להוסיף מרישים.`;
    }
  }
  return { info, warn };
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
  const plates: Plate[] = [
    ...resolved.flatMap((r) => (r.plate ? [r.plate] : [])),
    ...c.plates,
    ...design.plates.flatMap((p) => {
      const piece = platePiece(p, design.grid, c.frames);
      return piece ? [piece] : [];
    }),
  ];

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

/**
 * The part of the design a piece of its layout came from (a piece picked in 3D, on the grid or in the drawing): a
 * block for its pieces, a member for itself and its base plate, an infill for its bars, a plate. Null for anything
 * else (a piece of a layout made another way).
 */
export function elementOf(design: Design, pieceId: string): { kind: 'member' | 'infill' | 'block' | 'plate'; id: string } | null {
  const id = pieceId.split('#')[0];
  const block = id.includes('/') ? id.split('/')[0] : null;
  if (block) return design.blocks.some((k) => k.id === block) ? { kind: 'block', id: block } : null;
  if (design.plates.some((p) => p.id === id)) return { kind: 'plate', id };
  if (design.infills.some((f) => f.id === id)) return { kind: 'infill', id };
  const member = id.endsWith('-base') ? id.slice(0, -'-base'.length) : id;
  return design.members.some((m) => m.id === member) ? { kind: 'member', id: member } : null;
}

/** A plate between two opposite grid corners; on the face of the frame where there is one, else on the lines */
export function addPlate(design: Design, a: DesignNode, b: DesignNode, thickness = 3, sheet?: SheetKey): { design: Design; id: string | null } {
  if (plateError(a, b)) return { design, id: null };
  const id = newId('p', new Set(design.plates.map((p) => p.id)));
  const plate: DesignPlate = { id, a, b, thickness, fit: 'face', side: 1, ...(sheet && isSheet(sheet) ? { sheet, tint: sheetTint(sheet, null) } : {}) };
  // With nothing around it to sit on, a plate stands on its own, on the grid lines
  const alone = platePiece({ ...plate, fit: 'inside' }, design.grid, collect(design).frames);
  const onLines = platePiece({ ...plate, fit: 'center' }, design.grid, []);
  // On a level with rafters sloping off it (a sloped roof): lie on them
  if (a[1] === b[1]) {
    const withPlate = { ...design, plates: [...design.plates, plate] };
    const sloped = fitSlope(withPlate, id, { rafters: true });
    if (sloped) return { design: sloped, id };
  }
  const framed = alone && onLines && (alone.size[0] < onLines.size[0] - 0.5 || alone.size[1] < onLines.size[1] - 0.5);
  return { design: { ...design, plates: [...design.plates, framed ? plate : { ...plate, fit: 'center' }] }, id };
}

export function updatePlate(design: Design, id: string, patch: Partial<Omit<DesignPlate, 'id' | 'a' | 'b'>>): Design {
  return { ...design, plates: design.plates.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

export function removePlate(design: Design, id: string): Design {
  return { ...design, plates: design.plates.filter((p) => p.id !== id) };
}

/**
 * A measured spacing: it stops being a guess. The first measurement of a design that is all guesses (a sketch drawn
 * by eye) sets its scale too: every other spacing grows or shrinks by the same factor, rounded to 10 mm.
 */
export function setSpacing(design: Design, axis: GridAxis, index: number, value: number): Design {
  if (!(value > 0) || index < 0 || index >= design.grid[axis].length) return design;
  const v = Math.round(value);
  let grid = design.grid;
  const old = grid[axis][index];
  if (allGuessed(design) && old !== v) {
    const f = v / old;
    const scaled = (list: number[]) => list.map((s) => Math.max(10, Math.round((s * f) / 10) * 10));
    grid = { x: scaled(grid.x), y: scaled(grid.y), z: scaled(grid.z) };
  }
  const list = grid[axis].map((s, i) => (i === index ? v : s));
  return withGuess({ ...design, grid: { ...grid, [axis]: list } }, axis, guesses(design, axis).map((g, i) => g && i !== index));
}

/** Adds a bay at the end of an axis (same as the last one, or 1,000 for the first depth bay) */
export function addBay(design: Design, axis: GridAxis): Design {
  const list = design.grid[axis];
  if (list.length >= 40) return design;
  return withGuess({ ...design, grid: { ...design.grid, [axis]: [...list, list.at(-1) ?? 1000] } }, axis, [...guesses(design, axis), false]);
}

const AXIS_INDEX: Record<GridAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/**
 * A grid line at `pos` (mm from the first line) along an axis: the one already there (within half a millimetre),
 * or a new one that splits a bay, extends the grid past its last line, or (along X and Z) starts it earlier.
 * Everything already drawn keeps its place: node indices past the new line move up by one.
 * Returns the line's index. Levels never go below the ground. A line added this way is placed by eye (a pen or
 * finger stroke), so the bays it makes are marked as guesses until measured.
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
  let flags: boolean[];
  let index: number;
  let shiftFrom: number; // node indices >= this move up by one
  const was = guesses(design, axis);
  const last = lines[lines.length - 1];
  if (at > last) {
    list = [...spacings, at - last];
    flags = [...was, true];
    index = lines.length;
    shiftFrom = Number.POSITIVE_INFINITY;
  } else if (at < 0) {
    list = [-at, ...spacings];
    flags = [true, ...was];
    index = 0;
    shiftFrom = 0;
  } else {
    const bay = lines.findIndex((l, k) => k < lines.length - 1 && l < at && at < lines[k + 1]);
    list = [...spacings.slice(0, bay), at - lines[bay], lines[bay + 1] - at, ...spacings.slice(bay + 1)];
    flags = [...was.slice(0, bay), true, true, ...was.slice(bay + 1)];
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
    design: withGuess(
      {
        ...design,
        grid: { ...design.grid, [axis]: list },
        members: design.members.map((m) => ({ ...m, a: move(m.a), b: move(m.b) })),
        plates: design.plates.map((p) => ({ ...p, a: move(p.a), b: move(p.b) })),
        blocks: design.blocks.map((k) => ({ ...k, a: move(k.a), b: move(k.b) })),
      },
      axis,
      flags,
    ),
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
  const plates = design.plates.filter((p) => !onLast(p));
  let next: Design = withGuess({ ...design, blocks, plates, grid: { ...design.grid, [axis]: list.slice(0, -1) } }, axis, guesses(design, axis).slice(0, -1));
  for (const id of gone) next = removeMember(next, id);
  return { design: next, removed: gone.length + design.blocks.length - blocks.length + design.plates.length - plates.length };
}

/** The member's cut length once its ends are trimmed at the joints */
export function memberCutLengths(design: Design): Map<string, number> {
  return new Map(resolveJoints(collect(design).frames).map((r) => [r.m.id, Math.round(len(sub(r.to, r.from)))]));
}

/** Labels for grid lines: A, B, C… along X; 1, 2, 3… along Z; levels by height */
export const xLineName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `X${i + 1}`);
export const zLineName = (i: number) => String(i + 1);
