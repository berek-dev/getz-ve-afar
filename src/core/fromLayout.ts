/**
 * A model made by AI (or pasted) turned into a design for the builder ("לפי מידות"), so a small fix doesn't need a new
 * AI build. Every straight piece becomes a member between grid points; the grid is made of the coordinates the pieces
 * use. Ends that stop on the face of another piece are moved to its centre line, so the builder's joint rules trim
 * them back as the shop would. Evenly spaced bars between two parallel pieces become an infill, when the builder's
 * infill puts them where the AI did. Plates become plates on the grid lines; a plate under a post's foot becomes its
 * base plate. What the builder has no place for (curved pieces, hardware, concrete) is left out and listed.
 */
import { compileDesign, newDesign, readDesign } from './design.ts';
import type { Design, DesignInfill, DesignMember, DesignNode, DesignPlate, DesignWall } from './design.ts';
import { wallError } from './design.ts';
import { PART_LABELS, add, dot, halfExtent, len, norm, plateCorners, prepareScene, scale, sectionAxes, sub } from './scene.ts';
import type { Member, ResolvedMember, Vec3 } from './scene.ts';

/** Coordinates closer than this (mm) are one grid line */
const MERGE = 3;
/** How far the builder's infill bars may sit from the AI's at least, mm */
const BAR_SLACK = 15;

const dirOf = (m: ResolvedMember) => norm(sub(m.to, m.from));

/** The closest point to `p` on a member's centre line, and how far it is */
function closestOn(m: ResolvedMember, p: Vec3): { at: Vec3; d: number } {
  const ab = sub(m.to, m.from);
  const L2 = dot(ab, ab);
  const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, m.from), ab) / L2)) : 0;
  const at = add(m.from, scale(ab, t));
  return { at, d: len(sub(p, at)) };
}

/** How far a member's outside is from its centre line, towards `towards` */
function reach(m: ResolvedMember, towards: Vec3): number {
  const ax = sectionAxes(dirOf(m));
  return halfExtent(m, ax.f, ax.n, towards);
}

/** Sorted grid lines for some coordinates, close ones merged */
function linesOf(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || v - out[out.length - 1] > MERGE) out.push(v);
  return out;
}
const nearest = (lines: number[], v: number) => lines.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(lines[best] - v) ? i : best), 0);
/** Spacings between lines rounded where they are, so rounding doesn't add up along the grid */
const spacings = (lines: number[]) => lines.slice(1).map((v, i) => Math.round(v) - Math.round(lines[i]));

interface Piece {
  m: ResolvedMember;
  a: Vec3;
  b: Vec3;
  /** The piece each end stops on (an index into the pieces), or -1 */
  on: [number, number];
}

/** Bars that could be one infill: rails, bars sorted along the rails, the rail direction */
interface FillGroup {
  rails: [number, number];
  bars: number[];
  along: Vec3;
}

function fillGroups(pieces: Piece[]): FillGroup[] {
  const byKey = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    const [r, s] = p.on;
    if (r < 0 || s < 0 || r === s) return;
    const dr = dirOf(pieces[r].m);
    if (Math.abs(dot(dr, dirOf(pieces[s].m))) < 0.999) return;
    if (Math.abs(dot(dr, norm(sub(p.b, p.a)))) > 0.01) return;
    const key = `${Math.min(r, s)}|${Math.max(r, s)}|${p.m.profile}|${p.m.size.join('/')}`;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  });
  const out: FillGroup[] = [];
  for (const bars of byKey.values()) {
    if (bars.length < 3) continue;
    const [r, s] = pieces[bars[0]].on;
    const along = dirOf(pieces[r].m);
    const t = (i: number) => dot(pieces[i].a, along);
    bars.sort((i, j) => t(i) - t(j));
    const step = t(bars[1]) - t(bars[0]);
    if (bars.some((i, k) => k > 0 && Math.abs(t(i) - t(bars[k - 1]) - step) > 2)) continue;
    out.push({ rails: [Math.min(r, s), Math.max(r, s)], bars, along });
  }
  return out;
}

export function designFromLayout(layout: unknown): { design: Design; notes: string[]; missed: number } | null {
  const { scene, errors } = prepareScene(layout);
  if (errors.length > 0) return null;
  const notes: string[] = [];
  let missed = 0;

  const straight = scene.members.filter((m) => !m.via);
  const curved = scene.members.length - straight.length;
  if (curved > 0) {
    missed += curved;
    notes.push(curved === 1 ? 'חלק מעוגל אחד לא עבר (בבנייה לפי מידות אין קשתות)' : `${curved} חלקים מעוגלים לא עברו (בבנייה לפי מידות אין קשתות)`);
  }

  // Ends stopping on another piece's face move to its centre line
  const snap = (self: number, p: Vec3): { at: Vec3; on: number } => {
    let best: { at: Vec3; d: number; on: number } | null = null;
    for (let k = 0; k < straight.length; k++) {
      const o = straight[k];
      if (k === self) continue;
      if (len(sub(p, o.from)) < 0.5 || len(sub(p, o.to)) < 0.5) return { at: p, on: -1 };
      const c = closestOn(o, p);
      if (c.d > 0.5 && c.d <= reach(o, norm(sub(p, c.at))) + 2 && (!best || c.d < best.d)) best = { ...c, on: k };
    }
    return best ? { at: best.at, on: best.on } : { at: p, on: -1 };
  };
  // In the ground: the builder starts at ground level
  let buried = 0;
  const clamp = (p: Vec3): Vec3 => {
    if (p[1] >= -0.5) return p;
    buried++;
    return [p[0], 0, p[2]];
  };
  const pieces: Piece[] = straight.map((m, i) => {
    const a = snap(i, m.from);
    const b = snap(i, m.to);
    return { m, a: clamp(a.at), b: clamp(b.at), on: [a.on, b.on] };
  });
  if (buried > 0) notes.push('חלקים שנכנסו לקרקע מתחילים עכשיו בגובה הקרקע: להוסיף את הקטע שבבטון לאורך החיתוך');

  // Plates: a plate under a post's foot becomes its base plate; the rest stay plates
  const bases = new Map<number, { w: number; d: number; t: number }>();
  const plates = scene.plates.filter((p) => {
    if (p.normal !== 'y' || p.slope || p.sheet || p.center[1] > p.thickness + 1) return true;
    const post = pieces.findIndex(({ a, b }) => {
      const [foot, top] = a[1] <= b[1] ? [a, b] : [b, a];
      const upright = Math.abs(top[0] - foot[0]) < 1 && Math.abs(top[2] - foot[2]) < 1;
      return upright && Math.abs(foot[0] - p.center[0]) < 2 && Math.abs(foot[2] - p.center[2]) < 2 && foot[1] <= p.thickness + 1;
    });
    if (post < 0 || bases.has(post)) return true;
    bases.set(post, { w: Math.round(p.size[0]), d: Math.round(p.size[1]), t: p.thickness });
    return false;
  });
  // Sloped plates are laid level at their low edge; the slope tilts them back up
  const corners = plates.map((p) => {
    const cs = plateCorners(p);
    if (!p.slope) return cs;
    const low = Math.min(...cs.map((c) => c[1]));
    return cs.map((c): Vec3 => [c[0], low, c[2]]);
  });

  const build = (groups: FillGroup[]): { design: Design; origin: Vec3 } | null => {
    const inFill = new Set(groups.flatMap((g) => g.bars));
    const kept = pieces.map((_, i) => i).filter((i) => !inFill.has(i) && len(sub(pieces[i].a, pieces[i].b)) > 1);
    // The grid: every coordinate used, X and Z moved to start at 0, Y from the ground
    const points: Vec3[] = [...kept.flatMap((i) => [pieces[i].a, pieces[i].b]), ...corners.flat()];
    if (points.length === 0) return null;
    // Walls the work is fixed to (thin standing solids): their face nearest the work, as wide and tall as the work
    const lo = [0, 1, 2].map((k) => Math.min(...points.map((q) => q[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...points.map((q) => q[k])));
    const walls: { c1: Vec3; c2: Vec3; thickness: number }[] = [];
    for (const sol of scene.solids) {
      const tall = sol.size[1] >= 800;
      const thinX = sol.size[0] <= 600 && sol.size[0] <= 0.35 * sol.size[2];
      const thinZ = sol.size[2] <= 600 && sol.size[2] <= 0.35 * sol.size[0];
      if (!tall || thinX === thinZ) continue;
      const k = thinX ? 0 : 2;
      const o = thinX ? 2 : 0;
      const mid = (lo[k] + hi[k]) / 2;
      const [f1, f2] = [sol.center[k] - sol.size[k] / 2, sol.center[k] + sol.size[k] / 2];
      const face = Math.abs(f1 - mid) < Math.abs(f2 - mid) ? f1 : f2;
      const oLo = Math.max(lo[o], sol.center[o] - sol.size[o] / 2);
      const oHi = Math.min(hi[o], sol.center[o] + sol.size[o] / 2);
      const yLo = Math.max(0, sol.center[1] - sol.size[1] / 2);
      const yHi = Math.min(hi[1], sol.center[1] + sol.size[1] / 2);
      if (oHi - oLo < 50 || yHi - yLo < 50) continue;
      const c1: Vec3 = [0, yLo, 0];
      const c2: Vec3 = [0, yHi, 0];
      c1[k] = face;
      c2[k] = face;
      c1[o] = oLo;
      c2[o] = oHi;
      walls.push({ c1, c2, thickness: sol.size[k] });
      points.push(c1, c2);
    }
    const minX = Math.min(...points.map((p) => p[0]));
    const minZ = Math.min(...points.map((p) => p[2]));
    const xs = linesOf(points.map((p) => p[0] - minX));
    const ys = linesOf([0, ...points.map((p) => Math.max(0, p[1]))]);
    const zs = linesOf(points.map((p) => p[2] - minZ));
    const node = (p: Vec3): DesignNode => [nearest(xs, p[0] - minX), nearest(ys, Math.max(0, p[1])), nearest(zs, p[2] - minZ)];

    // The material most of the pieces are made of (the builder has one for the whole design)
    const counts = new Map<string, number>();
    for (const i of kept) counts.set(pieces[i].m.material, (counts.get(pieces[i].m.material) ?? 0) + 1);
    const material = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? scene.material;
    const design: Design = { ...newDesign(material as Design['material']), grid: { x: spacings(xs), y: spacings(ys), z: spacings(zs) } };
    if (design.grid.x.length === 0) design.grid.x = [1000];
    if (design.grid.y.length === 0) design.grid.y = [1000];

    const ids = new Map<number, string>();
    const used = new Set<string>();
    const members: DesignMember[] = [];
    for (const i of kept) {
      const { m, a, b } = pieces[i];
      const na = node(a);
      const nb = node(b);
      if (na.join() === nb.join()) continue;
      let id = m.id.replace(/#/g, '-');
      while (used.has(id)) id = `${id}x`;
      used.add(id);
      ids.set(i, id);
      const base = bases.get(i);
      members.push({ id, a: na, b: nb, profile: m.profile, size: [...m.size], ...(m.label ? { label: m.label } : {}), ...(base ? { base } : {}), ...(m.roll ? { roll: m.roll } : {}) });
    }
    design.members = members;

    const infills: DesignInfill[] = [];
    groups.forEach((g, k) => {
      const [r, s] = g.rails.map((i) => ids.get(i));
      if (!r || !s) return;
      const bar = pieces[g.bars[0]];
      const wbar = 2 * reach(bar.m, g.along);
      // The builder spreads the bars with equal clear gaps over the length the rails share: the gap that gives as many
      // bars as the AI drew, rounded up
      const t = (p: Vec3) => dot(p, g.along);
      const [ra, rb] = g.rails.map((i) => pieces[i].m);
      const span = Math.min(Math.max(t(ra.from), t(ra.to)), Math.max(t(rb.from), t(rb.to))) - Math.max(Math.min(t(ra.from), t(ra.to)), Math.min(t(rb.from), t(rb.to)));
      const n = g.bars.length;
      const gap = Math.ceil((span - n * wbar) / (n + 1) - 1e-6);
      if (!(gap > 0)) return;
      infills.push({ id: `f${k + 1}`, between: [r, s], profile: bar.m.profile, size: [...bar.m.size], gap, ...(bar.m.label ? { label: bar.m.label } : {}) });
    });
    design.infills = infills;

    const designPlates: DesignPlate[] = [];
    plates.forEach((p, i) => {
      const cs = corners[i].map(node);
      const lo: DesignNode = [0, 1, 2].map((k) => Math.min(...cs.map((c) => c[k]))) as DesignNode;
      const hi: DesignNode = [0, 1, 2].map((k) => Math.max(...cs.map((c) => c[k]))) as DesignNode;
      if ([0, 1, 2].filter((k) => lo[k] === hi[k]).length !== 1) return;
      designPlates.push({
        id: `p${i + 1}`,
        a: lo,
        b: hi,
        thickness: p.thickness,
        fit: 'center',
        side: 1,
        ...(p.label ? { label: p.label } : {}),
        ...(p.sheet ? { sheet: p.sheet, ...(p.tint ? { tint: p.tint } : {}) } : {}),
        ...(p.slope ? { slope: { up: p.slope.up, deg: p.slope.deg } } : {}),
      });
    });
    design.plates = designPlates;
    const designWalls: DesignWall[] = walls
      .map((w, i) => ({ id: `w${i + 1}`, a: node(w.c1), b: node(w.c2), thickness: Math.max(50, Math.min(1000, Math.round(w.thickness))) }))
      .filter((w) => !wallError(w.a, w.b));
    if (designWalls.length) design.walls = designWalls;
    return { design, origin: [minX, 0, minZ] };
  };

  /** Whether the builder puts an infill's bars where the AI had them */
  const fillMatches = ({ design, origin }: { design: Design; origin: Vec3 }, g: FillGroup, id: string): boolean => {
    const out = (compileDesign(design, '').members as Member[]).find((m) => m.id === id);
    if (!out) return false;
    const count = out.repeat?.count ?? 1;
    if (count !== g.bars.length) return false;
    const first = dot(add(out.from, origin), g.along);
    const last = first + dot(out.repeat?.step ?? [0, 0, 0], g.along) * (count - 1);
    const ai = g.bars.map((i) => dot(pieces[i].a, g.along));
    // Bars spread by their centres (as an AI's "between" does) sit up to half a bar off equal gaps at the ends
    const slack = Math.max(BAR_SLACK, reach(pieces[g.bars[0]].m, g.along) + 5);
    return Math.abs(Math.min(first, last) - Math.min(...ai)) <= slack && Math.abs(Math.max(first, last) - Math.max(...ai)) <= slack;
  };

  const groups = fillGroups(pieces);
  let built = build(groups);
  if (built && groups.length > 0) {
    const tried = built;
    const ok = groups.filter((g, k) => tried.design.infills.some((f) => f.id === `f${k + 1}`) && fillMatches(tried, g, `f${k + 1}`));
    if (ok.length !== groups.length) built = build(ok);
  }
  if (!built) return null;
  const { design } = built;
  const lostPlates = plates.length - design.plates.length;
  if (lostPlates > 0) {
    missed += lostPlates;
    notes.push(lostPlates === 1 ? 'פח אחד לא עבר (לא שוכב על קווי הרשת)' : `${lostPlates} פחים לא עברו (לא שוכבים על קווי הרשת)`);
  }

  // Hardware and concrete have no place in the builder
  const parts = new Map<string, number>();
  for (const p of scene.parts) {
    const label = p.label ?? PART_LABELS[p.kind];
    parts.set(label, (parts.get(label) ?? 0) + 1);
  }
  if (parts.size > 0) notes.push(`פרזול שלא עבר (להוסיף בכתב הכמויות): ${[...parts].map(([l, n]) => (n > 1 ? `${l} ${n}` : l)).join(', ')}`);
  const others = scene.solids.length - (design.walls?.length ?? 0);
  if (design.walls?.length) notes.push(design.walls.length === 1 ? 'הקיר מההדמיה עבר: חלקים שמגיעים אליו מעוגנים אליו בבדיקת החוזק' : `${design.walls.length} קירות מההדמיה עברו`);
  if (others > 0) notes.push('בטון וריצוף מההדמיה לא עברו');

  // Through the same checks as a saved design, so the builder can open it
  const read = readDesign(JSON.parse(JSON.stringify(design)));
  if (!read) return null;
  return { design: read, notes, missed };
}
