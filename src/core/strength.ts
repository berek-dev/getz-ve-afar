/**
 * A rough strength check of a model, to help pick profiles before the engineer's approval (it does not replace it).
 * The members become a 3D frame (`frame3d.ts`) with welded, rigid joints: an end that stops on another piece's face
 * joins its centre line, pieces that cross within touching distance are joined where they cross, and ends at the
 * ground (or on concrete) are supports. Loads: the steel's own weight, plates and roofing spread onto the members
 * under them by the width each one carries, a load on roofs for people doing upkeep, and wind: on the members and
 * solid plates from four directions, pushing roofs down or lifting them. Factored as in EN 1990 (1.35 and 1.5),
 * each piece is checked for stress (bending and axial, elastic), buckling of what is pressed (curve c), sag of
 * beams (span/200) and sway at the top of posts (height/150). Moving leaves (gates) are left out.
 */
import { sectionProps } from './sectionProps.ts';
import type { SectionProps } from './sectionProps.ts';
import { checkPoints, elementAxes, forcesAt, midDisplacement, solveFrame } from './frame3d.ts';
import type { CaseResult, ElementResult, Frame, FrameElement, LoadCase } from './frame3d.ts';
import { add, arcPoint, arcThrough, dot, halfExtent, len, norm, plateAxes, rolledAxes, scale, sectionAxes, sectionName, sub } from './scene.ts';
import type { Profile, ResolvedMember, ResolvedScene, Vec3 } from './scene.ts';
import { materialInfo, standardSizes } from './catalog.ts';
import type { MaterialKey } from './catalog.ts';
import { isSheet, sheetInfo } from './sheets.ts';

export interface StrengthSettings {
  /** People on the roof for upkeep, kN/m² on plan */
  roofLoad: number;
  /** Peak wind pressure at the site, kN/m² */
  wind: number;
  /** Posts at the ground: fixed (a base plate on four anchors, or set in concrete) or a hinge */
  base: 'fixed' | 'pinned';
  /**
   * Pieces that end on a wall: a hinge (a beam bolted on through a plate or along a ledger) or fixed (a plate with
   * anchors top and bottom, holding a canopy that hangs on the wall with nothing under it)
   */
  wall: 'fixed' | 'pinned';
}

export const DEFAULT_STRENGTH: StrengthSettings = { roofLoad: 0.4, wind: 0.8, base: 'fixed', wall: 'pinned' };

export type Verdict = 'ok' | 'close' | 'fail';
export type Governs = 'stress' | 'buckling' | 'deflection' | 'sway';

export interface MemberResult {
  id: string;
  name: string;
  label?: string;
  length: number;
  util: number;
  verdict: Verdict;
  governs: Governs;
  /** The check that decides, in a few words ("כיפוף", "שקיעה 12 מ״מ, מותר 15") */
  why: string;
  /** The loading that decides it */
  case: string;
  suggest?: { size: number[]; name: string; util: number };
}

export interface SupportResult {
  at: Vec3;
  /** Largest push down and pull up, sideways force and bending moment over the factored cases; kN and kN·m */
  down: number;
  up: number;
  shear: number;
  moment: number;
}

export interface StrengthReport {
  status: 'ok' | 'close' | 'fail' | 'unstable' | 'empty';
  members: MemberResult[];
  /** Per scene member id, for colouring */
  verdicts: Record<string, Verdict>;
  sway: { mm: number; limit: number; at: Vec3 } | null;
  sag: { mm: number; limit: number; id: string } | null;
  supports: SupportResult[];
  /** Members not joined to anything that stands on the ground */
  loose: string[];
  /** Pieces of leaves that move (gates): not checked themselves; their weight and wind go to the posts */
  movers: number;
  /** Leaves whose post (or guide) was not found, so their loads are missing */
  leavesMissing: number;
  /** Plates with no members under them to carry them */
  unsupported: string[];
  /** Points held by a wall */
  wallSupports: number;
  unstableAt: Vec3 | null;
  steelKg: number;
  roofArea: number;
  settings: StrengthSettings;
}

const MAT: Record<MaterialKey, { E: number; G: number; fy: number }> = {
  black: { E: 210000, G: 81000, fy: 235 },
  galv: { E: 210000, G: 81000, fy: 235 },
  stainless: { E: 200000, G: 77000, fy: 210 },
  aluminum: { E: 70000, G: 26000, fy: 150 },
};
const G_ACC = 9.81;
/** Touching distance: an end this far past a face still counts as on it, mm */
const TOL = 4;
/** Points on a member closer than this are one node, mm */
const MERGE = 5;
const GROUND = 2;

// ------------------------------------------------------------------------------------------- the frame

interface Seg {
  mi: number;
  a: Vec3;
  b: Vec3;
  dir: Vec3;
  L: number;
  /** Section axes turned by the member's roll (the element's local z and y) */
  f: Vec3;
  n: Vec3;
  /** Before the roll, as halfExtent takes them */
  f0: Vec3;
  n0: Vec3;
  props: SectionProps;
  /** The member's true ends are a of its first segment and b of its last */
  first: boolean;
  last: boolean;
}

/** Union–find over point keys */
class Groups {
  parent: number[] = [];
  make(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  join(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

interface Point {
  t: number;
  key: number;
  pos: Vec3;
  /** Which positions win when points merge: on a through member (2), where two cross (1), a member's end (0) */
  rank: number;
  ground?: boolean;
}

/** How far a member's outside is from its centre line, towards `along` */
const reach = (m: ResolvedMember, s: Seg, along: Vec3) => halfExtent(m, s.f0, s.n0, along);

function closestOnSeg(s: Seg, p: Vec3): { t: number; at: Vec3; d: number } {
  const t = Math.max(0, Math.min(1, dot(sub(p, s.a), s.dir) / s.L));
  const at = add(s.a, scale(s.dir, t * s.L));
  return { t, at, d: len(sub(p, at)) };
}

/** Closest points of two segments (parameters along each) */
function closestBetween(p: Seg, q: Seg): { s: number; t: number; d: number; pa: Vec3; pb: Vec3 } {
  const d1 = sub(p.b, p.a);
  const d2 = sub(q.b, q.a);
  const r = sub(p.a, q.a);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const c = dot(d1, r);
  const b = dot(d1, d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = Math.max(0, Math.min(1, -c / a));
  } else if (t > 1) {
    t = 1;
    s = Math.max(0, Math.min(1, (b - c) / a));
  }
  const pa = add(p.a, scale(d1, s));
  const pb = add(q.a, scale(d2, t));
  return { s, t, d: len(sub(pa, pb)), pa, pb };
}

type Dir = '+x' | '-x' | '+z' | '-z';
const DIR_VEC: Record<Dir, Vec3> = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };

/** A load a moving leaf puts on a post: at a hinge or a guide roller */
interface LeafLoad {
  member: number;
  at: Vec3;
  G: Vec3;
  W: Partial<Record<Dir, Vec3>>;
}

/**
 * What gate leaves put on their posts. A swinging leaf hangs on its hinges: its weight shared between them, plus the
 * pair of sideways forces that hold it up at its centre of gravity, and the wind on it shared between them. A sliding
 * leaf runs on the ground: only the wind goes to the posts, at its guide rollers. The leaf itself is not checked.
 */
function leafLoads(scene: ResolvedScene, members: ResolvedMember[], settings: StrengthSettings): { loads: LeafLoad[]; missing: number } {
  const loads: LeafLoad[] = [];
  let missing = 0;
  const qp = settings.wind / 1000;
  const posts = members.map((m, i) => ({ m, i })).filter(({ m }) => Math.abs(norm(sub(m.to, m.from))[1]) > 0.9);
  const postAt = (p: Vec3, within: number) => {
    let best: { i: number; d: number; m: ResolvedMember } | null = null;
    for (const { m, i } of posts) {
      const d = Math.hypot(m.from[0] - p[0], m.from[2] - p[2]);
      const [lo, hi] = [Math.min(m.from[1], m.to[1]), Math.max(m.from[1], m.to[1])];
      if (d <= within && p[1] >= lo - 50 && p[1] <= hi + 50 && (!best || d < best.d)) best = { i, d, m };
    }
    return best;
  };
  for (const g of scene.groups) {
    if (!g.motion) continue;
    const ms = scene.members.filter((m) => m.group === g.id);
    const ps = scene.plates.filter((p) => p.group === g.id);
    if (ms.length + ps.length === 0) continue;
    let W = 0;
    let c: Vec3 = [0, 0, 0];
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    const grow = (q: Vec3) => [0, 1, 2].forEach((k) => ((lo[k] = Math.min(lo[k], q[k])), (hi[k] = Math.max(hi[k], q[k]))));
    for (const m of ms) {
      const pr = sectionProps(m.profile, m.size);
      if (!pr) continue;
      const w = (pr.A * (materialInfo(m.material)?.density ?? 7.85) * 1e-6 * G_ACC) * len(sub(m.to, m.from));
      W += w;
      c = add(c, scale(add(m.from, m.to), w / 2));
      grow(m.from);
      grow(m.to);
    }
    for (const p of ps) {
      const w = (plateKgPerM2(p) * G_ACC * p.size[0] * p.size[1]) / 1e6;
      W += w;
      c = add(c, scale(p.center, w));
      grow(p.center);
    }
    if (!(W > 0)) continue;
    c = scale(c, 1 / W);
    // The leaf's plane: it is thin across one of X and Z
    const across: Vec3 = hi[0] - lo[0] < hi[2] - lo[2] ? [1, 0, 0] : [0, 0, 1];
    let area = 0;
    for (const m of ms) {
      const d = norm(sub(m.to, m.from));
      const perp = sub(across, scale(d, dot(across, d)));
      if (len(perp) < 0.05) continue;
      const ax = sectionAxes(d);
      area += 2 * halfExtent(m, ax.f, ax.n, norm(perp)) * len(sub(m.to, m.from)) * len(perp) * 2.0;
    }
    for (const p of ps) area += p.size[0] * p.size[1] * 1.3 * Math.abs(dot(plateAxes(p).n, across));
    // Never more than a solid panel of the leaf's outline would catch
    const gross = (across[0] ? hi[2] - lo[2] : hi[0] - lo[0]) * (hi[1] - lo[1]);
    const F = qp * Math.min(area, 1.3 * gross);
    const wind = (share: number): Partial<Record<Dir, Vec3>> => {
      const out: Partial<Record<Dir, Vec3>> = {};
      for (const d of Object.keys(DIR_VEC) as Dir[]) if (Math.abs(dot(DIR_VEC[d], across)) > 0.5) out[d] = scale(DIR_VEC[d], F * share);
      return out;
    };
    if (g.motion.type === 'swing') {
      const pivot = g.motion.pivot;
      const post = postAt(pivot, 400);
      if (!post) {
        missing++;
        continue;
      }
      const hinges = scene.parts.filter((p) => p.kind === 'hinge' && Math.hypot(p.at[0] - pivot[0], p.at[2] - pivot[2]) < 300).map((p) => p.at[1]);
      const ys = hinges.length >= 2 ? [Math.min(...hinges), Math.max(...hinges)] : [lo[1] + 0.15 * (hi[1] - lo[1]), hi[1] - 0.15 * (hi[1] - lo[1])];
      const at = (y: number): Vec3 => [post.m.from[0], y, post.m.from[2]];
      const out = norm([c[0] - pivot[0], 0, c[2] - pivot[2]]);
      const e = Math.hypot(c[0] - pivot[0], c[2] - pivot[2]);
      const H = ys[1] - ys[0] > 100 ? (W * e) / (ys[1] - ys[0]) : 0;
      // The bottom hinge is pushed away from the leaf, the top one pulled towards it
      loads.push({ member: post.i, at: at(ys[0]), G: add([0, -W / 2, 0], scale(out, -H)), W: wind(0.5) });
      loads.push({ member: post.i, at: at(ys[1]), G: add([0, -W / 2, 0], scale(out, H)), W: wind(0.5) });
    } else {
      const rollers = scene.parts.filter((p) => p.kind === 'guide_roller');
      const held = rollers.map((r) => ({ r, post: postAt(r.at, 400) })).filter((x) => x.post);
      if (held.length === 0) {
        missing++;
        continue;
      }
      // The wheels take the bottom half of the wind to the ground; the rollers hold the top half
      for (const { r, post } of held) {
        const p = post as NonNullable<typeof post>;
        loads.push({ member: p.i, at: [p.m.from[0], r.at[1], p.m.from[2]], G: [0, 0, 0], W: wind(0.5 / held.length) });
      }
    }
  }
  return { loads, missing };
}

interface Built {
  frame: Frame;
  /** Per element: its segment and member */
  elSeg: number[];
  segs: Seg[];
  members: ResolvedMember[];
  /** Members (by index into `members`) per connected node, to find joints along a member */
  nodeMembers: Set<number>[];
  groundNodes: Set<number>;
  /** Members lying on the ground along their length (a track): held all along, no sag */
  onGround: Set<number>;
  /** How many of the supports are on a wall's face */
  wallSupports: number;
  loose: Set<number>;
  /** Node of each leaf load, or -1 when its post was left out */
  leafNodes: number[];
}

function buildFrame(scene: ResolvedScene, settings: StrengthSettings, members: ResolvedMember[], leaves: LeafLoad[]): Built {
  const segs: Seg[] = [];
  members.forEach((m, mi) => {
    const props = sectionProps(m.profile, m.size) as SectionProps;
    let pts: Vec3[] = [m.from, m.to];
    if (m.via) {
      const arc = arcThrough(m.from, m.via, m.to);
      if (arc) pts = Array.from({ length: 9 }, (_, i) => arcPoint(arc, i / 8));
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const L = len(sub(b, a));
      if (L < 1) continue;
      const dir = norm(sub(b, a));
      const ax = sectionAxes(dir);
      const { f, n } = rolledAxes(ax.f, ax.n, m.roll);
      segs.push({ mi, a, b, dir, L, f, n, f0: ax.f, n0: ax.n, props, first: i === 0, last: i === pts.length - 2 });
    }
  });

  const keys = new Groups();
  const points: Point[][] = segs.map(() => []);
  const addPoint = (si: number, t: number, rank: number, ground = false): Point => {
    const s = segs[si];
    const p: Point = { t, key: keys.make(), pos: add(s.a, scale(s.dir, t * s.L)), rank, ground };
    points[si].push(p);
    return p;
  };
  const ends = segs.map((_, si) => [addPoint(si, 0, 0), addPoint(si, 1, 0)] as [Point, Point]);
  // Lying on the ground: its underside at ground level
  const lying = (si: number, p: Point) => p.pos[1] - reach(members[segs[si].mi], segs[si], [0, -1, 0]) <= GROUND + TOL;
  const onGround = new Set<number>();
  segs.forEach((s, si) => {
    for (const p of ends[si]) if (p.pos[1] > GROUND && lying(si, p)) p.ground = true;
    if (Math.abs(s.dir[1]) < 0.1 && ends[si].every((p) => p.ground || p.pos[1] <= GROUND)) onGround.add(s.mi);
  });
  // Where leaves hang: points on their posts
  const leafPoints = leaves.map((l) => {
    const si = segs.findIndex((s) => s.mi === l.member && closestOnSeg(s, l.at).d < 1 + reach(members[s.mi], s, [1, 0, 0]));
    if (si < 0) return null;
    return addPoint(si, closestOnSeg(segs[si], l.at).t, 2);
  });
  // The segments of a bent member follow on from each other
  for (let si = 1; si < segs.length; si++) if (segs[si].mi === segs[si - 1].mi && !segs[si].first) keys.join(ends[si][0].key, ends[si - 1][1].key);

  // Parts in the ground stop at ground level, where they are held
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si];
    if ((s.a[1] < -GROUND) !== (s.b[1] < -GROUND)) {
      const t = s.a[1] / (s.a[1] - s.b[1]);
      addPoint(si, Math.max(0, Math.min(1, t)), 2, true);
    }
  }

  // An end on another member's face joins its centre line
  segs.forEach((s, si) => {
    for (const [end, p] of [
      [s.first, ends[si][0]],
      [s.last, ends[si][1]],
    ] as const) {
      if (!end) continue;
      let best: { sj: number; t: number; d: number } | null = null;
      for (let sj = 0; sj < segs.length; sj++) {
        const o = segs[sj];
        if (o.mi === s.mi) continue;
        const c = closestOnSeg(o, p.pos);
        const toward = c.d > 0.5 ? norm(sub(p.pos, c.at)) : o.f;
        if (c.d <= reach(members[o.mi], o, toward) + TOL && (!best || c.d < best.d)) best = { sj, t: c.t, d: c.d };
      }
      if (!best) continue;
      const o = segs[best.sj];
      // Near the other's end: join that end rather than a new point beside it
      const atEnd = best.t * o.L < MERGE ? ends[best.sj][0] : (1 - best.t) * o.L < MERGE ? ends[best.sj][1] : null;
      const q = atEnd ?? addPoint(best.sj, best.t, 2);
      keys.join(p.key, q.key);
    }
  });

  // Pieces that cross within touching distance are welded where they cross
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i];
      const q = segs[j];
      if (p.mi === q.mi || Math.abs(dot(p.dir, q.dir)) > 0.98) continue;
      const c = closestBetween(p, q);
      if (c.s * p.L < MERGE || (1 - c.s) * p.L < MERGE || c.t * q.L < MERGE || (1 - c.t) * q.L < MERGE) continue;
      const gap = c.d > 0.5 ? norm(sub(c.pb, c.pa)) : p.f;
      if (c.d > reach(members[p.mi], p, gap) + reach(members[q.mi], q, gap) + TOL) continue;
      const a = addPoint(i, c.s, 1);
      const b = addPoint(j, c.t, 1);
      keys.join(a.key, b.key);
    }
  }

  // Points close together along a segment are one
  points.forEach((list, si) => {
    list.sort((x, y) => x.t - y.t);
    for (let k = 1; k < list.length; k++) if ((list[k].t - list[k - 1].t) * segs[si].L < MERGE) keys.join(list[k].key, list[k - 1].key);
  });

  points.forEach((list, si) => {
    if (onGround.has(segs[si].mi)) for (const p of list) p.ground = true;
  });

  // Nodes: one per group of points, placed by the highest-ranked points in it
  const nodeOf = new Map<number, number>();
  const gather = new Map<number, { rank: number; sum: Vec3; n: number; ground: boolean }>();
  for (const list of points) {
    for (const p of list) {
      const r = keys.find(p.key);
      const g = gather.get(r);
      if (!g || p.rank > g.rank) gather.set(r, { rank: p.rank, sum: [...p.pos] as Vec3, n: 1, ground: !!p.ground || !!g?.ground });
      else if (p.rank === g.rank) {
        g.sum = add(g.sum, p.pos);
        g.n++;
        g.ground ||= !!p.ground;
      } else g.ground ||= !!p.ground;
    }
  }
  const nodes: Vec3[] = [];
  const groundFlag: boolean[] = [];
  for (const [r, g] of gather) {
    nodeOf.set(r, nodes.length);
    nodes.push(scale(g.sum, 1 / g.n));
    groundFlag.push(g.ground);
  }

  const elements: FrameElement[] = [];
  const elSeg: number[] = [];
  const nodeMembers: Set<number>[] = nodes.map(() => new Set());
  segs.forEach((s, si) => {
    const m = members[s.mi];
    const mat = MAT[m.material] ?? MAT.black;
    const list = points[si];
    let prev: number | null = null;
    for (const p of list) {
      const node = nodeOf.get(keys.find(p.key)) as number;
      nodeMembers[node].add(s.mi);
      if (prev !== null && node !== prev) {
        const below = nodes[prev][1] < -GROUND || nodes[node][1] < -GROUND;
        if (!below && len(sub(nodes[node], nodes[prev])) > 1) {
          elements.push({ a: prev, b: node, A: s.props.A, Iy: s.props.In, Iz: s.props.If, J: s.props.J, E: mat.E, G: mat.G, y: s.n });
          elSeg.push(si);
        }
      }
      prev = node;
    }
  });

  // Supports: at the ground, or on concrete and walls
  const fixed = settings.base === 'fixed' ? [true, true, true, true, true, true] : [true, true, true, false, true, false];
  const onWall = settings.wall === 'fixed' ? [true, true, true, true, true, true] : [true, true, true, false, false, false];
  const supports = new Map<number, boolean[]>();
  const groundNodes = new Set<number>();
  const wallNodes = new Set<number>();
  const used = new Set(elements.flatMap((e) => [e.a, e.b]));
  nodes.forEach((p, i) => {
    if (!used.has(i)) return;
    if (p[1] <= GROUND || groundFlag[i]) {
      supports.set(i, fixed);
      groundNodes.add(i);
      return;
    }
    const boxes = [...scene.solids, ...scene.parts.filter((x) => x.kind === 'footing' && x.size?.length === 3).map((x) => ({ center: x.at, size: x.size as Vec3 }))];
    for (const s of boxes) {
      const inside = [0, 1, 2].every((k) => Math.abs(p[k] - s.center[k]) <= s.size[k] / 2 + 15);
      if (!inside) continue;
      // Standing on it (inside its top, not on a face) or fixed to its side (a wall's face)
      const within = (k: 0 | 2) => Math.abs(p[k] - s.center[k]) < s.size[k] / 2 - 15;
      const onTop = p[1] >= s.center[1] + s.size[1] / 2 - 15 && within(0) && within(2);
      supports.set(i, onTop ? fixed : onWall);
      if (!onTop) wallNodes.add(i);
      groundNodes.add(i);
      return;
    }
  });

  // Pieces in groups that reach no support can't stand: left out, listed
  const reachG = new Groups();
  const nodeKey = nodes.map(() => reachG.make());
  for (const e of elements) reachG.join(nodeKey[e.a], nodeKey[e.b]);
  const held = new Set([...supports.keys()].map((i) => reachG.find(nodeKey[i])));
  const keep = elements.map((e) => held.has(reachG.find(nodeKey[e.a])));
  const loose = new Set<number>();
  elements.forEach((_, i) => !keep[i] && loose.add(segs[elSeg[i]].mi));

  // Renumber to the nodes still in use
  const kept = elements.filter((_, i) => keep[i]);
  const keptSeg = elSeg.filter((_, i) => keep[i]);
  const usedNodes = [...new Set(kept.flatMap((e) => [e.a, e.b]))].sort((x, y) => x - y);
  const renum = new Map(usedNodes.map((n, i) => [n, i]));
  const frame: Frame = {
    nodes: usedNodes.map((n) => nodes[n]),
    elements: kept.map((e) => ({ ...e, a: renum.get(e.a) as number, b: renum.get(e.b) as number })),
    supports: new Map([...supports].filter(([n]) => renum.has(n)).map(([n, s]) => [renum.get(n) as number, s])),
  };
  return {
    frame,
    elSeg: keptSeg,
    segs,
    members,
    nodeMembers: usedNodes.map((n) => nodeMembers[n]),
    groundNodes: new Set([...groundNodes].filter((n) => renum.has(n)).map((n) => renum.get(n) as number)),
    onGround,
    wallSupports: [...wallNodes].filter((n) => renum.has(n)).length,
    loose,
    leafNodes: leafPoints.map((p) => {
      if (!p) return -1;
      const node = nodeOf.get(keys.find(p.key));
      return node !== undefined && renum.has(node) ? (renum.get(node) as number) : -1;
    }),
  };
}

// ------------------------------------------------------------------------------------------- loads

type Plate = ResolvedScene['plates'][number];

/**
 * A plate's load onto the members that carry it: the ones lying in (or just under) its plane inside its outline,
 * in the direction most of them run; each carries the width halfway to its neighbours. `pressure` N/mm² over the
 * plate's area, along `dir`. Null when nothing carries it.
 */
function spread(b: Built, p: Plate, pressure: number, dir: Vec3, out: Map<number, Vec3>): boolean {
  const { u, v, n } = plateAxes(p);
  const [hu, hv] = [p.size[0] / 2, p.size[1] / 2];
  const t = p.thickness ?? 3;
  type Cand = { el: number; along: 'u' | 'v'; at: number; share: number };
  const cands: Cand[] = [];
  b.frame.elements.forEach((e, i) => {
    const s = b.segs[b.elSeg[i]];
    if (Math.abs(dot(s.dir, n)) > 0.25) return;
    const pa = sub(b.frame.nodes[e.a], p.center);
    const pb = sub(b.frame.nodes[e.b], p.center);
    const band = reach(b.members[s.mi], s, n) + t / 2 + 80;
    if (Math.abs(dot(pa, n)) > band || Math.abs(dot(pb, n)) > band) return;
    const [ua, va, ub, vb] = [dot(pa, u), dot(pa, v), dot(pb, u), dot(pb, v)];
    const along = Math.abs(ub - ua) >= Math.abs(vb - va) ? 'u' : 'v';
    // The part of the element inside the plate's outline
    const [s0, s1, c0, c1, hs, hc] = along === 'u' ? [ua, ub, va, vb, hu, hv] : [va, vb, ua, ub, hv, hu];
    const at = (c0 + c1) / 2;
    if (Math.abs(at) > hc + 10) return;
    const lo = Math.max(Math.min(s0, s1), -hs);
    const hi = Math.min(Math.max(s0, s1), hs);
    const L = Math.abs(s1 - s0);
    if (hi - lo < 1 || L < 1) return;
    cands.push({ el: i, along, at, share: (hi - lo) / L });
  });
  if (cands.length === 0) return false;
  const linesOf = (along: 'u' | 'v') => {
    const list = cands.filter((c) => c.along === along).sort((x, y) => x.at - y.at);
    const lines: { at: number; els: Cand[] }[] = [];
    for (const c of list) {
      const last = lines[lines.length - 1];
      if (last && c.at - last.at < 20) last.els.push(c);
      else lines.push({ at: c.at, els: [c] });
    }
    return lines;
  };
  const byU = linesOf('u');
  const byV = linesOf('v');
  // The sheet spans between the lines of the direction with more of them (purlins), or the closer-spaced one
  const spacing = (lines: { at: number }[]) => (lines.length > 1 ? (lines[lines.length - 1].at - lines[0].at) / (lines.length - 1) : Infinity);
  const lines = byU.length !== byV.length ? (byU.length > byV.length ? byU : byV) : spacing(byU) <= spacing(byV) ? byU : byV;
  const half = lines === byU ? hv : hu;
  lines.forEach((line, k) => {
    const lo = k === 0 ? -half : (lines[k - 1].at + line.at) / 2;
    const hi = k === lines.length - 1 ? half : (line.at + lines[k + 1].at) / 2;
    const width = Math.max(0, hi - lo);
    for (const c of line.els) {
      const q = scale(dir, pressure * width * c.share);
      out.set(c.el, add(out.get(c.el) ?? [0, 0, 0], q));
    }
  });
  return true;
}

const isRoof = (p: Plate) => p.normal === 'y' && p.center[1] > 1000;
const plateKgPerM2 = (p: Plate) => {
  if (p.sheet && isSheet(p.sheet)) return sheetInfo(p.sheet)?.kgPerM2 ?? 1.5;
  return (p.thickness ?? 3) * (materialInfo(p.material)?.density ?? 7.85);
};

interface Cases {
  G: LoadCase;
  Q: LoadCase;
  W: Record<'+x' | '-x' | '+z' | '-z', LoadCase>;
  down: LoadCase;
  up: LoadCase;
  unsupported: string[];
  roofArea: number;
}

function loadCases(b: Built, scene: ResolvedScene, s: StrengthSettings, leaves: LeafLoad[]): Cases {
  const moving = new Set(scene.groups.filter((g) => g.motion).map((g) => g.id));
  const G = new Map<number, Vec3>();
  const Q = new Map<number, Vec3>();
  const down = new Map<number, Vec3>();
  const up = new Map<number, Vec3>();
  const W = { '+x': new Map<number, Vec3>(), '-x': new Map<number, Vec3>(), '+z': new Map<number, Vec3>(), '-z': new Map<number, Vec3>() };
  const qp = s.wind / 1000; // N/mm²
  // Own weight and wind on the members
  b.frame.elements.forEach((_, i) => {
    const seg = b.segs[b.elSeg[i]];
    const m = b.members[seg.mi];
    const rho = materialInfo(m.material)?.density ?? 7.85;
    G.set(i, [0, -(seg.props.A * rho * 1e-6 * G_ACC), 0]);
    const round = m.profile === 'round_tube' || m.profile === 'round_bar';
    for (const [key, w] of Object.entries({ '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }) as [keyof typeof W, Vec3][]) {
      const perp = sub(w, scale(seg.dir, dot(w, seg.dir)));
      const l = len(perp);
      if (l < 0.05) continue;
      const width = 2 * reach(m, seg, norm(perp));
      W[key].set(i, scale(perp, qp * (round ? 1.2 : 2.0) * width));
    }
  });
  const unsupported: string[] = [];
  let roofArea = 0;
  for (const p of scene.plates) {
    if (p.center[1] < 50 && p.normal === 'y') continue; // base plates sit on the footing
    if (p.group && moving.has(p.group)) continue; // goes with its leaf
    const area = p.size[0] * p.size[1];
    const { n } = plateAxes(p);
    const weight = (plateKgPerM2(p) * G_ACC) / 1e6;
    if (!spread(b, p, weight, [0, -1, 0], G)) {
      unsupported.push(p.id);
      continue;
    }
    if (isRoof(p)) {
      roofArea += area;
      const cos = Math.abs(n[1]);
      spread(b, p, (s.roofLoad / 1000) * cos, [0, -1, 0], Q);
      // Wind on a roof: pushed down, or lifted (net coefficients of an open canopy)
      spread(b, p, qp * 0.5, scale(n, -1), down);
      spread(b, p, qp * 1.0, n, up);
    } else if (Math.abs(n[1]) < 0.5) {
      // A solid wall or leaf catches the wind on its face
      for (const [key, w] of Object.entries({ '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }) as [keyof typeof W, Vec3][]) {
        const facing = dot(w, n);
        if (Math.abs(facing) < 0.05) continue;
        spread(b, p, qp * 1.3 * Math.abs(facing), facing > 0 ? n : scale(n, -1), W[key]);
      }
    }
  }
  const nodal = (pick: (l: LeafLoad) => Vec3 | undefined) => {
    const out = new Map<number, number[]>();
    leaves.forEach((l, i) => {
      const node = b.leafNodes[i];
      const f = pick(l);
      if (node < 0 || !f) return;
      const prev = out.get(node) ?? [0, 0, 0, 0, 0, 0];
      out.set(node, [prev[0] + f[0], prev[1] + f[1], prev[2] + f[2], 0, 0, 0]);
    });
    return out;
  };
  const lc = (line: Map<number, Vec3>, pick?: (l: LeafLoad) => Vec3 | undefined): LoadCase => ({ line, ...(pick ? { nodal: nodal(pick) } : {}) });
  return {
    G: lc(G, (l) => l.G),
    Q: lc(Q),
    W: { '+x': lc(W['+x'], (l) => l.W['+x']), '-x': lc(W['-x'], (l) => l.W['-x']), '+z': lc(W['+z'], (l) => l.W['+z']), '-z': lc(W['-z'], (l) => l.W['-z']) },
    down: lc(down),
    up: lc(up),
    unsupported,
    roofArea,
  };
}

// ------------------------------------------------------------------------------------------- checking

interface Combo {
  name: string;
  /** Factors on the base cases: G, Q, W+x, W-x, W+z, W-z, down, up */
  f: number[];
  uls: boolean;
}

const DIRS: Dir[] = ['+x', '-x', '+z', '-z'];
const DIR_NAME: Record<Dir, string> = { '+x': 'רוח לרוחב', '-x': 'רוח לרוחב', '+z': 'רוח לעומק', '-z': 'רוח לעומק' };

function combos(roof: boolean): Combo[] {
  const out: Combo[] = [{ name: roof ? 'משקל ועומס על הגג' : 'משקל', f: [1.35, 1.5, 0, 0, 0, 0, 0, 0], uls: true }];
  DIRS.forEach((d, i) => {
    const w = [0, 0, 0, 0];
    w[i] = 1.5;
    out.push({ name: roof ? `${DIR_NAME[d]} שלוחצת על הגג` : DIR_NAME[d], f: [1.35, 0, ...w, 1.5, 0], uls: true });
    out.push({ name: roof ? `${DIR_NAME[d]} שמרימה את הגג` : DIR_NAME[d], f: [1.0, 0, ...w, 0, 1.5], uls: true });
  });
  out.push({ name: roof ? 'משקל ועומס על הגג' : 'משקל', f: [1, 1, 0, 0, 0, 0, 0, 0], uls: false });
  DIRS.forEach((d, i) => {
    const w = [0, 0, 0, 0];
    w[i] = 1;
    out.push({ name: DIR_NAME[d], f: [1, 0, ...w, 1, 0], uls: false });
    out.push({ name: DIR_NAME[d], f: [1, 0, ...w, 0, 1], uls: false });
  });
  return out;
}

function combine(base: CaseResult[], f: number[]): CaseResult {
  const first = base[0];
  const u = first.u.map((row, i) => row.map((_, k) => base.reduce((s, c, j) => s + f[j] * c.u[i][k], 0)));
  const elements: ElementResult[] = first.elements.map((_, e) => ({
    a: first.elements[e].a.map((_, k) => base.reduce((s, c, j) => s + f[j] * c.elements[e].a[k], 0)),
    b: first.elements[e].b.map((_, k) => base.reduce((s, c, j) => s + f[j] * c.elements[e].b[k], 0)),
    q: [0, 1, 2].map((k) => base.reduce((s, c, j) => s + f[j] * c.elements[e].q[k], 0)) as Vec3,
  }));
  return { u, elements };
}

/** EN 1993 buckling reduction, curve c */
function chi(A: number, I: number, Lb: number, E: number, fy: number): number {
  if (!(I > 0) || !(Lb > 0)) return 1;
  const Ncr = (Math.PI ** 2 * E * I) / (Lb * Lb);
  const lam = Math.sqrt((A * fy) / Ncr);
  if (lam <= 0.2) return 1;
  const phi = 0.5 * (1 + 0.49 * (lam - 0.2) + lam * lam);
  return Math.min(1, 1 / (phi + Math.sqrt(phi * phi - lam * lam)));
}

interface Demand {
  /** Per ULS combo: largest compression, and the largest moments about each axis anywhere on the member */
  uls: { Nc: number; My: number; Mz: number; sigma: { N: number; My: number; Mz: number } }[];
  /** Sag over the allowed, and the length it was measured over */
  sag: number;
  sagMm: number;
  sagLimit: number;
  sway: number;
}

/** The utilisation of a section under a member's forces (and its sag and sway, scaled by stiffness) */
function utilOf(p: SectionProps, mat: { E: number; fy: number }, d: Demand, Lb: number, K: number, stiff: { In: number; Imin: number }) {
  let stress = 0;
  let buckling = 0;
  for (const c of d.uls) {
    stress = Math.max(stress, (Math.abs(c.sigma.N) / p.A + Math.abs(c.sigma.My) / p.Wn + Math.abs(c.sigma.Mz) / p.Wf) / mat.fy);
    if (c.Nc > 0) {
      const x = chi(p.A, p.Imin, K * Lb, mat.E, mat.fy);
      buckling = Math.max(buckling, c.Nc / (x * p.A * mat.fy) + c.My / (p.Wn * mat.fy) + c.Mz / (p.Wf * mat.fy));
    }
  }
  const sag = d.sag * (stiff.In / p.In);
  const sway = d.sway * (stiff.Imin / Math.min(p.If, p.In));
  return { stress, buckling, sag, sway };
}

export function checkStrength(scene: ResolvedScene, settings: StrengthSettings = DEFAULT_STRENGTH): StrengthReport {
  const empty: StrengthReport = {
    status: 'empty',
    members: [],
    verdicts: {},
    sway: null,
    sag: null,
    supports: [],
    loose: [],
    movers: 0,
    leavesMissing: 0,
    unsupported: [],
    wallSupports: 0,
    unstableAt: null,
    steelKg: 0,
    roofArea: 0,
    settings,
  };
  const moving = new Set(scene.groups.filter((g) => g.motion).map((g) => g.id));
  const movers = scene.members.filter((m) => m.group && moving.has(m.group)).length;
  const members = scene.members.filter((m) => !(m.group && moving.has(m.group)) && sectionProps(m.profile, m.size));
  const leaves = leafLoads(scene, members, settings);
  const b = buildFrame(scene, settings, members, leaves.loads);
  const loose = [...b.loose].map((i) => b.members[i].id);
  const leavesMissing = leaves.missing;
  if (b.frame.elements.length === 0) return { ...empty, movers, leavesMissing, loose };
  const cases = loadCases(b, scene, settings, leaves.loads);
  const base = [cases.G, cases.Q, cases.W['+x'], cases.W['-x'], cases.W['+z'], cases.W['-z'], cases.down, cases.up];
  const solved = solveFrame(b.frame, base);
  if (!solved.ok) return { ...empty, status: 'unstable', wallSupports: b.wallSupports, movers, leavesMissing, loose, unstableAt: b.frame.nodes[solved.node], unsupported: cases.unsupported, roofArea: cases.roofArea };
  const all = combos(cases.roofArea > 0).map((c) => ({ ...c, r: combine(solved.cases, c.f) }));
  const uls = all.filter((c) => c.uls);
  const sls = all.filter((c) => !c.uls);

  // Elements of each member, in order along it
  const byMember = new Map<number, number[]>();
  b.elSeg.forEach((si, e) => {
    const mi = b.segs[si].mi;
    byMember.set(mi, [...(byMember.get(mi) ?? []), e]);
  });

  // Sway: the top of everything standing, sideways, against its height
  let sway: StrengthReport['sway'] = null;
  const swayAt = new Map<number, number>();
  for (const c of sls) {
    b.frame.nodes.forEach((p, i) => {
      if (p[1] < 300) return;
      const u = c.r.u[i];
      const mm = Math.hypot(u[0], u[2]);
      const limit = p[1] / 150;
      swayAt.set(i, Math.max(swayAt.get(i) ?? 0, mm / limit));
      if (!sway || mm / limit > sway.mm / sway.limit) sway = { mm, limit, at: p };
    });
  }

  const results: MemberResult[] = [];
  const supportsTouch = new Set(b.groundNodes);
  let worstSag: StrengthReport['sag'] = null;
  for (const [mi, els] of byMember) {
    if (b.onGround.has(mi)) continue;
    const m = b.members[mi];
    const seg0 = b.segs[b.elSeg[els[0]]];
    const p = seg0.props;
    const mat = MAT[m.material] ?? MAT.black;
    const memberDir = norm(sub(m.to, m.from));
    const Lm = els.reduce((s, e) => s + len(sub(b.frame.nodes[b.frame.elements[e].b], b.frame.nodes[b.frame.elements[e].a])), 0);
    const demand: Demand = { uls: [], sag: 0, sagMm: 0, sagLimit: 0, sway: 0 };
    for (const c of uls) {
      let Nc = 0;
      let My = 0;
      let Mz = 0;
      let worst = { N: 0, My: 0, Mz: 0 };
      let worstSigma = -1;
      for (const e of els) {
        const er = c.r.elements[e];
        const fe = b.frame.elements[e];
        const L = len(sub(b.frame.nodes[fe.b], b.frame.nodes[fe.a]));
        for (const x of checkPoints(er, L)) {
          const f = forcesAt(er, x);
          Nc = Math.max(Nc, -f.N);
          My = Math.max(My, Math.abs(f.My));
          Mz = Math.max(Mz, Math.abs(f.Mz));
          const sigma = Math.abs(f.N) / p.A + Math.abs(f.My) / p.Wn + Math.abs(f.Mz) / p.Wf;
          if (sigma > worstSigma) {
            worstSigma = sigma;
            worst = f;
          }
        }
      }
      demand.uls.push({ Nc, My, Mz, sigma: worst });
    }
    // Sag of members that lie (beams, purlins, rafters): against the line between where they are held
    if (Math.abs(memberDir[1]) < 0.6 && !b.onGround.has(mi)) {
      const pts: { t: number; pos: Vec3; node: number | null; el: number | null }[] = [];
      for (const e of els) {
        const fe = b.frame.elements[e];
        for (const node of [fe.a, fe.b]) pts.push({ t: dot(sub(b.frame.nodes[node], m.from), memberDir), pos: b.frame.nodes[node], node, el: null });
        const mid = scale(add(b.frame.nodes[fe.a], b.frame.nodes[fe.b]), 0.5);
        pts.push({ t: dot(sub(mid, m.from), memberDir), pos: mid, node: null, el: e });
      }
      pts.sort((x, y) => x.t - y.t);
      const others = (node: number) => [...b.nodeMembers[node]].filter((o) => o !== mi);
      const held = pts.filter((q) => q.node !== null && (supportsTouch.has(q.node) || others(q.node).some((o) => Math.abs(norm(sub(b.members[o].to, b.members[o].from))[1]) > 0.7)));
      const joined = pts.filter((q) => q.node !== null && (supportsTouch.has(q.node) || others(q.node).length > 0));
      const chord = held.length >= 2 ? [held[0], held[held.length - 1]] : joined.length >= 2 ? [joined[0], joined[joined.length - 1]] : joined.length === 1 ? [joined[0], joined[0]] : null;
      if (chord) {
        for (const c of sls) {
          const disp = (q: (typeof pts)[number]): Vec3 => {
            if (q.node !== null) return [c.r.u[q.node][0], c.r.u[q.node][1], c.r.u[q.node][2]];
            const e = q.el as number;
            return midDisplacement(b.frame, b.frame.elements[e], c.r.u, c.r.elements[e].q);
          };
          const [A, B] = chord;
          const dA = disp(A);
          const dB = disp(B);
          for (const q of pts) {
            const span = B.t - A.t;
            let ref: Vec3;
            let limit: number;
            if (q.t < A.t - 1 || q.t > B.t + 1 || span < 1) {
              // Past the last support: an overhang, twice as much allowed over its length
              const from = q.t < A.t ? A : B;
              ref = from === A ? dA : dB;
              limit = (2 * Math.abs(q.t - from.t)) / 200;
            } else {
              const k = (q.t - A.t) / span;
              ref = add(scale(dA, 1 - k), scale(dB, k));
              limit = span / 200;
            }
            if (limit < 1) continue;
            const rel = sub(disp(q), ref);
            const perp = len(sub(rel, scale(memberDir, dot(rel, memberDir))));
            if (perp / limit > demand.sag) {
              demand.sag = perp / limit;
              demand.sagMm = perp;
              demand.sagLimit = limit;
            }
          }
        }
      }
    } else {
      // Standing pieces: the sway at their nodes
      for (const e of els) for (const node of [b.frame.elements[e].a, b.frame.elements[e].b]) demand.sway = Math.max(demand.sway, swayAt.get(node) ?? 0);
    }

    const onGround = els.some((e) => supportsTouch.has(b.frame.elements[e].a) || supportsTouch.has(b.frame.elements[e].b));
    const K = Math.abs(memberDir[1]) > 0.9 && onGround ? 2 : 1;
    const u = utilOf(p, mat, demand, Lm, K, { In: p.In, Imin: Math.min(p.If, p.In) });
    const parts: [Governs, number][] = [
      ['stress', u.stress],
      ['buckling', u.buckling],
      ['deflection', u.sag],
      ['sway', u.sway],
    ];
    let [governs, util] = parts.reduce((best, x) => (x[1] > best[1] ? x : best));
    // Hardly pressed: the buckling check is the bending check with a little added; call it bending
    if (governs === 'buckling') {
      const press = Math.max(0, ...demand.uls.map((d) => d.Nc / (chi(p.A, p.Imin, K * Lm, mat.E, mat.fy) * p.A * mat.fy)));
      if (press < 0.15 * util) governs = 'stress';
    }
    const worstCombo = (() => {
      let k = 0;
      let top = -1;
      demand.uls.forEach((d, i) => {
        const v = Math.abs(d.sigma.N) / p.A + Math.abs(d.sigma.My) / p.Wn + Math.abs(d.sigma.Mz) / p.Wf;
        if (v > top) {
          top = v;
          k = i;
        }
      });
      return uls[k]?.name ?? '';
    })();
    const why =
      governs === 'deflection'
        ? `שקיעה ${Math.round(demand.sagMm)} מ״מ, מותר ${Math.round(demand.sagLimit)}`
        : governs === 'sway'
          ? 'תזוזה הצידה ברוח'
          : governs === 'buckling'
            ? 'לחיצה וקריסה'
            : 'כיפוף';
    const verdict: Verdict = util > 1 ? 'fail' : util > 0.8 ? 'close' : 'ok';
    const res: MemberResult = {
      id: m.id,
      name: sectionName(m.profile, m.size, m.material),
      ...(m.label ? { label: m.label } : {}),
      length: Math.round(Lm),
      util,
      verdict,
      governs,
      why,
      case: governs === 'deflection' ? 'בשימוש רגיל' : governs === 'sway' ? 'ברוח' : worstCombo,
    };
    if (verdict === 'fail') {
      const better = suggestSize(m.profile, m.size, m.material, mat, demand, Lm, K, p);
      if (better) res.suggest = better;
    }
    results.push(res);
    if (Math.abs(memberDir[1]) < 0.6 && !b.onGround.has(mi) && demand.sagLimit > 0 && (!worstSag || demand.sag > worstSag.mm / worstSag.limit)) worstSag = { mm: demand.sagMm, limit: demand.sagLimit, id: m.id };
  }

  // Supports: what each footing or anchor has to hold
  const supports: SupportResult[] = [];
  for (const node of b.frame.supports.keys()) {
    let down = 0;
    let up = 0;
    let shear = 0;
    let moment = 0;
    for (const c of uls) {
      const R: number[] = [0, 0, 0, 0, 0, 0];
      b.frame.elements.forEach((e, i) => {
        if (e.a !== node && e.b !== node) return;
        const er = c.r.elements[i];
        const end = e.a === node ? er.a : er.b;
        const [x, yv, z] = elementAxes(b.frame, e).R;
        for (let k = 0; k < 3; k++) {
          R[k] += x[k] * end[0] + yv[k] * end[1] + z[k] * end[2];
          R[3 + k] += x[k] * end[3] + yv[k] * end[4] + z[k] * end[5];
        }
      });
      // R is what the elements take from the node; the support gives the same
      down = Math.max(down, R[1]);
      up = Math.max(up, -R[1]);
      shear = Math.max(shear, Math.hypot(R[0], R[2]));
      moment = Math.max(moment, Math.hypot(R[3], R[5]));
    }
    supports.push({ at: b.frame.nodes[node], down: down / 1000, up: up / 1000, shear: shear / 1000, moment: moment / 1e6 });
  }
  supports.sort((x, y) => x.at[0] - y.at[0] || x.at[2] - y.at[2]);

  results.sort((x, y) => y.util - x.util);
  const verdicts: Record<string, Verdict> = {};
  for (const r of results) verdicts[r.id] = r.verdict;
  const worst = results[0]?.verdict ?? 'ok';
  const steelKg = b.members.reduce((s, m) => {
    const pr = sectionProps(m.profile, m.size);
    return s + (pr ? (pr.A * (materialInfo(m.material)?.density ?? 7.85) * len(sub(m.to, m.from))) / 1e6 : 0);
  }, 0);
  return {
    status: worst === 'fail' ? 'fail' : worst === 'close' ? 'close' : 'ok',
    members: results,
    verdicts,
    sway,
    sag: worstSag,
    supports,
    loose,
    movers,
    leavesMissing,
    unsupported: cases.unsupported,
    wallSupports: b.wallSupports,
    unstableAt: null,
    steelKg,
    roofArea: cases.roofArea,
    settings,
  };
}

/** The lightest standard size of the same profile that would hold the same forces, keeping its way round */
function suggestSize(profile: Profile, size: number[], material: MaterialKey, mat: { E: number; fy: number }, d: Demand, Lb: number, K: number, now: SectionProps): MemberResult['suggest'] | undefined {
  const tall = (size[0] ?? 0) >= (size[1] ?? 0);
  let best: { size: number[]; kg: number; util: number } | null = null;
  for (const cand of standardSizes(profile, material)) {
    const c = profile === 'rect_tube' || profile === 'angle' ? (tall === cand[0] >= cand[1] ? cand : [cand[1], cand[0], ...cand.slice(2)]) : cand;
    const p = sectionProps(profile, c);
    if (!p) continue;
    const u = utilOf(p, mat, d, Lb, K, { In: now.In, Imin: Math.min(now.If, now.In) });
    const util = Math.max(u.stress, u.buckling, u.sag, u.sway);
    if (util > 0.9) continue;
    // The lightest; between two that weigh the same, the one with more to spare
    if (!best || p.A < best.kg - 0.5 || (Math.abs(p.A - best.kg) <= 0.5 && util < best.util)) best = { size: c, kg: p.A, util };
  }
  return best ? { size: best.size, name: sectionName(profile, best.size, material), util: best.util } : undefined;
}
