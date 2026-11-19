/**
 * 3D layout of a metalwork job ("scene"): what an AI (or a template) produces from a description and
 * the bill of quantities, and what the viewer, the shop drawing and the cut list read.
 *
 * Data, not code: millimetres, Y up, ground at y = 0, X along the opening (left to right seen from the
 * street), +Z towards the street. Members are pieces of profile between two points on their centre line,
 * so a member's length is its cut length (butt joints).
 */
import { kgFor } from './steel.ts';
import type { SteelShape } from './steel.ts';
import { BEAMS } from './sections.ts';
import { INCH, MATERIAL_KEYS, materialInfo } from './catalog.ts';
import type { MaterialKey } from './catalog.ts';

export type Vec3 = [number, number, number];
export type Axis = 'x' | 'y' | 'z';

export type Profile = 'rect_tube' | 'round_tube' | 'round_bar' | 'square_bar' | 'flat' | 'angle' | 'upn' | 'ipe' | 'hea';
export const PROFILES: readonly Profile[] = ['rect_tube', 'round_tube', 'round_bar', 'square_bar', 'flat', 'angle', 'upn', 'ipe', 'hea'];
const SIZE_LEN: Record<Profile, number> = {
  rect_tube: 3,
  round_tube: 2,
  round_bar: 1,
  square_bar: 1,
  flat: 2,
  angle: 3,
  upn: 1,
  ipe: 1,
  hea: 1,
};

export interface Repeat {
  count: number;
  /** Copies at i × step */
  step?: Vec3;
  /** Or: copies spread evenly strictly between two coordinates on an axis */
  between?: [number, number];
  axis?: Axis;
}

export type EndCap = 'finial' | 'ball' | 'cap';

export interface Member {
  id?: string;
  profile: Profile;
  size: number[];
  material?: MaterialKey;
  from: Vec3;
  to: Vec3;
  /** A point on the curve: the member is a circular arc from → via → to */
  via?: Vec3;
  /** Degrees about the member's own axis */
  roll?: number;
  group?: string;
  label?: string;
  color?: string;
  repeat?: Repeat;
  /** Id of a member to stop at (e.g. pickets under an arch) */
  trim_to?: string;
  end_cap?: EndCap;
}

export interface Plate {
  id?: string;
  center: Vec3;
  /** In-plane size: normal z → [x, y]; normal x → [z, y]; normal y → [x, z] */
  size: [number, number];
  normal: Axis;
  thickness: number;
  material?: MaterialKey;
  group?: string;
  label?: string;
  color?: string;
  repeat?: Repeat;
}

export type PartKind =
  | 'hinge'
  | 'wheel'
  | 'guide_roller'
  | 'lock'
  | 'handle'
  | 'drop_bolt'
  | 'stopper'
  | 'footing'
  | 'motor'
  | 'cap'
  | 'finial'
  | 'scroll';
export const PART_KINDS: readonly PartKind[] = [
  'hinge',
  'wheel',
  'guide_roller',
  'lock',
  'handle',
  'drop_bolt',
  'stopper',
  'footing',
  'motor',
  'cap',
  'finial',
  'scroll',
];
export const PART_LABELS: Record<PartKind, string> = {
  hinge: 'ציר',
  wheel: 'גלגל',
  guide_roller: 'מוביל עליון',
  lock: 'מנעול',
  handle: 'ידית',
  drop_bolt: 'בריח רצפה',
  stopper: 'עוצר',
  footing: 'יסוד בטון',
  motor: 'מנוע',
  cap: 'כיפה',
  finial: 'קישוט ראש',
  scroll: 'סלסול',
};

export interface Part {
  id?: string;
  kind: PartKind;
  at: Vec3;
  size?: number[];
  axis?: Axis;
  group?: string;
  label?: string;
  repeat?: Repeat;
}

export type SolidKind = 'concrete' | 'stone' | 'plaster' | 'wood' | 'paving';
export interface Solid {
  kind?: SolidKind;
  center: Vec3;
  size: Vec3;
  label?: string;
}

export type Motion = { type: 'swing'; pivot: Vec3; angle: number } | { type: 'slide'; offset: Vec3 };
export interface Group {
  id: string;
  label?: string;
  motion?: Motion;
}

export interface Dimension {
  from: Vec3;
  to: Vec3;
  label?: string;
}

export interface Scene {
  version: 1;
  title: string;
  material?: MaterialKey;
  finish?: { color?: string; name?: string };
  members: Member[];
  plates?: Plate[];
  parts?: Part[];
  solids?: Solid[];
  groups?: Group[];
  dimensions?: Dimension[];
  notes?: string[];
  source?: { title: string; url: string };
}

/** A scene after repeats, trims and defaults: every item has an id and a material. */
export interface ResolvedMember extends Member {
  id: string;
  material: MaterialKey;
}
export interface ResolvedScene extends Omit<Scene, 'members' | 'plates' | 'parts'> {
  members: ResolvedMember[];
  plates: (Plate & { id: string; material: MaterialKey })[];
  parts: (Part & { id: string })[];
  solids: Solid[];
  groups: Group[];
}

// --- Vector math -----------------------------------------------------------------------------------

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};
const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/**
 * Cross-section axes of a straight member with direction d:
 * f carries size[0] (the face you see), n carries size[1] (the depth).
 * Vertical members: f = X, n = Z. Others: n is horizontal and square to the member, f is in the vertical
 * plane through the member (so a horizontal rail's face is its height).
 */
export function sectionAxes(direction: Vec3): { f: Vec3; n: Vec3 } {
  const d = norm(direction);
  if (Math.abs(d[1]) > 0.999) return { f: [1, 0, 0], n: [0, 0, 1] };
  const n = norm(cross([0, 1, 0], d));
  return { f: norm(cross(d, n)), n };
}

export interface Arc {
  center: Vec3;
  radius: number;
  /** Unit normal of the arc's plane; a → via → to runs counter-clockwise about it */
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  /** Radians from `from` to `to` */
  sweep: number;
}

/** The circle through three points, or null if they are (nearly) in line. */
export function arcThrough(a: Vec3, b: Vec3, c: Vec3): Arc | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-6 * dot(ab, ab) * dot(ac, ac)) return null;
  const center = add(a, scale(add(scale(cross(n, ab), dot(ac, ac)), scale(cross(ac, n), dot(ab, ab))), 1 / (2 * n2)));
  const radius = len(sub(a, center));
  const normal = norm(n);
  const u = norm(sub(a, center));
  const v = cross(normal, u);
  const angleOf = (p: Vec3) => {
    const w = sub(p, center);
    const t = Math.atan2(dot(w, v), dot(w, u));
    return t < 0 ? t + 2 * Math.PI : t;
  };
  return { center, radius, normal, u, v, sweep: angleOf(c) };
}

export function arcPoint(arc: Arc, t: number): Vec3 {
  const a = arc.sweep * t;
  return add(arc.center, add(scale(arc.u, arc.radius * Math.cos(a)), scale(arc.v, arc.radius * Math.sin(a))));
}

export function memberLength(m: Pick<Member, 'from' | 'to' | 'via'>): number {
  if (m.via) {
    const arc = arcThrough(m.from, m.via, m.to);
    if (arc) return arc.radius * arc.sweep;
  }
  return len(sub(m.to, m.from));
}

/** Half the section's extent along a direction (for stopping a member at another one's face). */
export function halfExtent(m: Pick<Member, 'profile' | 'size'>, f: Vec3, n: Vec3, along: Vec3): number {
  const [s0 = 0, s1 = s0] = m.size;
  const roundish = m.profile === 'round_tube' || m.profile === 'round_bar';
  if (roundish) return s0 / 2;
  const beam = m.profile === 'upn' || m.profile === 'ipe' || m.profile === 'hea' ? BEAMS[m.profile][s0] : null;
  const face = beam ? beam.h : s0;
  const depth = beam ? beam.b : m.profile === 'square_bar' ? s0 : s1;
  return (Math.abs(dot(along, f)) * face + Math.abs(dot(along, n)) * depth) / 2;
}

// --- Preparing an AI's output: validate, expand repeats, apply trims ----------------------------------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const MAX_COORD = 60_000;
function vec(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) return null;
  return v.every((x) => Math.abs(x) <= MAX_COORD) ? [v[0], v[1], v[2]] : null;
}
const text = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const isAxis = (v: unknown): v is Axis => v === 'x' || v === 'y' || v === 'z';
const isMaterial = (v: unknown): v is MaterialKey => MATERIAL_KEYS.includes(v as MaterialKey);

function repeatOffsets(r: unknown, base: Vec3): Vec3[] | string {
  if (r == null) return [[0, 0, 0]];
  const rep = r as Repeat;
  const count = Math.round(Number(rep.count));
  if (!(count >= 1 && count <= 400)) return 'repeat.count must be 1–400';
  if (rep.between) {
    const [a, b] = rep.between;
    if (!finite(a) || !finite(b) || !isAxis(rep.axis)) return 'repeat.between needs [a, b] and axis';
    const i0 = AXIS_INDEX[rep.axis];
    return Array.from({ length: count }, (_, i) => {
      const o: Vec3 = [0, 0, 0];
      o[i0] = a + ((i + 1) * (b - a)) / (count + 1) - base[i0];
      return o;
    });
  }
  const step = vec(rep.step);
  if (!step) return 'repeat needs step [dx,dy,dz] or between + axis';
  return Array.from({ length: count }, (_, i) => scale(step, i));
}

export interface Prepared {
  scene: ResolvedScene;
  warnings: string[];
  errors: string[];
}

/** Turns raw JSON (from an AI or a file) into a scene the viewer can draw. Bad items are dropped with a warning. */
export function prepareScene(raw: unknown): Prepared {
  const warnings: string[] = [];
  const errors: string[] = [];
  const src = (raw ?? {}) as Partial<Scene>;
  const defMaterial: MaterialKey = isMaterial(src.material) ? src.material : 'black';

  const groups: Group[] = [];
  for (const [i, g] of (Array.isArray(src.groups) ? src.groups : []).entries()) {
    const id = text(g?.id, 40);
    if (!id || groups.some((x) => x.id === id)) {
      warnings.push(`groups[${i}]: id חסר או כפול`);
      continue;
    }
    let motion: Motion | undefined;
    const m = g.motion as Motion | undefined;
    if (m?.type === 'swing') {
      const pivot = vec(m.pivot);
      if (pivot && finite(m.angle)) motion = { type: 'swing', pivot, angle: Math.max(-180, Math.min(180, m.angle)) };
    } else if (m?.type === 'slide') {
      const offset = vec(m.offset);
      if (offset) motion = { type: 'slide', offset };
    }
    if (g.motion && !motion) warnings.push(`groups[${i}]: תנועה לא תקינה`);
    groups.push({ id, label: text(g.label), motion });
  }
  const groupOk = (g: unknown, where: string) => {
    if (g == null) return undefined;
    if (groups.some((x) => x.id === g)) return g as string;
    warnings.push(`${where}: קבוצה "${String(g)}" לא קיימת`);
    return undefined;
  };

  // Members
  const members: ResolvedMember[] = [];
  const rawMembers = Array.isArray(src.members) ? src.members : [];
  let auto = 0;
  for (const [i, m] of rawMembers.entries()) {
    const where = `members[${i}]`;
    if (!m || !PROFILES.includes(m.profile)) {
      warnings.push(`${where}: פרופיל לא מוכר`);
      continue;
    }
    const size = Array.isArray(m.size) ? m.size.slice(0, SIZE_LEN[m.profile]) : [];
    if (size.length !== SIZE_LEN[m.profile] || !size.every((x) => finite(x) && x > 0 && x < 2000)) {
      warnings.push(`${where}: מידות חתך לא תקינות`);
      continue;
    }
    if ((m.profile === 'upn' || m.profile === 'ipe' || m.profile === 'hea') && !BEAMS[m.profile][size[0]]) {
      warnings.push(`${where}: אין ${m.profile.toUpperCase()} ${size[0]} בטבלה`);
      continue;
    }
    const from = vec(m.from);
    const to = vec(m.to);
    if (!from || !to || len(sub(to, from)) < 1) {
      warnings.push(`${where}: נקודות התחלה וסוף לא תקינות`);
      continue;
    }
    let via = m.via == null ? undefined : (vec(m.via) ?? undefined);
    if (via && !arcThrough(from, via, to)) {
      warnings.push(`${where}: הקשת ישרה, צוירה כקו`);
      via = undefined;
    }
    const offsets = repeatOffsets(m.repeat, from);
    if (typeof offsets === 'string') {
      warnings.push(`${where}: ${offsets}`);
      continue;
    }
    const id = text(m.id, 40) ?? `m${++auto}`;
    const base = {
      profile: m.profile,
      size,
      material: isMaterial(m.material) ? m.material : defMaterial,
      roll: finite(m.roll) ? m.roll : undefined,
      group: groupOk(m.group, where),
      label: text(m.label),
      color: typeof m.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(m.color) ? m.color : undefined,
      trim_to: text(m.trim_to, 40),
      end_cap: m.end_cap === 'finial' || m.end_cap === 'ball' || m.end_cap === 'cap' ? m.end_cap : undefined,
    };
    offsets.forEach((o, k) => {
      members.push({
        ...base,
        id: offsets.length > 1 ? `${id}#${k + 1}` : id,
        from: add(from, o),
        to: add(to, o),
        via: via ? add(via, o) : undefined,
      });
    });
  }
  if (members.length > 4000) {
    errors.push('יותר מדי חלקים במודל');
    members.length = 4000;
  }

  // Trims: stop a member where it meets another one's face
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const m of members) {
    if (!m.trim_to) continue;
    const target = byId.get(m.trim_to);
    if (!target || target === m || m.via) {
      warnings.push(`${m.id}: אי אפשר לחתוך אל "${m.trim_to}"`);
      continue;
    }
    const s = trimDistance(m, target);
    if (s === null) warnings.push(`${m.id}: לא פוגש את "${m.trim_to}"`);
    else m.to = add(m.from, scale(norm(sub(m.to, m.from)), s));
  }

  // Plates
  const plates: ResolvedScene['plates'] = [];
  for (const [i, p] of (Array.isArray(src.plates) ? src.plates : []).entries()) {
    const where = `plates[${i}]`;
    const center = vec(p?.center);
    const size = Array.isArray(p?.size) && p.size.length === 2 && p.size.every((x) => finite(x) && x > 0) ? p.size : null;
    if (!center || !size || !isAxis(p.normal) || !(finite(p.thickness) && p.thickness > 0 && p.thickness < 200)) {
      warnings.push(`${where}: פח לא תקין`);
      continue;
    }
    const offsets = repeatOffsets(p.repeat, center);
    if (typeof offsets === 'string') {
      warnings.push(`${where}: ${offsets}`);
      continue;
    }
    const id = text(p.id, 40) ?? `p${i + 1}`;
    offsets.forEach((o, k) =>
      plates.push({
        id: offsets.length > 1 ? `${id}#${k + 1}` : id,
        center: add(center, o),
        size: [size[0], size[1]],
        normal: p.normal,
        thickness: p.thickness,
        material: isMaterial(p.material) ? p.material : defMaterial,
        group: groupOk(p.group, where),
        label: text(p.label),
        color: typeof p.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : undefined,
      }),
    );
  }

  // Parts
  const parts: ResolvedScene['parts'] = [];
  for (const [i, p] of (Array.isArray(src.parts) ? src.parts : []).entries()) {
    const where = `parts[${i}]`;
    const at = vec(p?.at);
    if (!at || !PART_KINDS.includes(p.kind)) {
      warnings.push(`${where}: חלק לא מוכר`);
      continue;
    }
    const offsets = repeatOffsets(p.repeat, at);
    if (typeof offsets === 'string') {
      warnings.push(`${where}: ${offsets}`);
      continue;
    }
    const size = Array.isArray(p.size) && p.size.every((x) => finite(x) && x > 0) ? p.size.slice(0, 3) : undefined;
    offsets.forEach((o, k) =>
      parts.push({
        id: `${text(p.id, 40) ?? `x${i + 1}`}${offsets.length > 1 ? `#${k + 1}` : ''}`,
        kind: p.kind,
        at: add(at, o),
        size,
        axis: isAxis(p.axis) ? p.axis : undefined,
        group: groupOk(p.group, where),
        label: text(p.label),
      }),
    );
  }

  const solids: Solid[] = [];
  for (const s of Array.isArray(src.solids) ? src.solids : []) {
    const center = vec(s?.center);
    const size = vec(s?.size);
    if (center && size && size.every((x) => x > 0)) solids.push({ kind: s.kind, center, size, label: text(s.label) });
  }

  const dimensions: Dimension[] = [];
  for (const d of Array.isArray(src.dimensions) ? src.dimensions : []) {
    const from = vec(d?.from);
    const to = vec(d?.to);
    if (from && to) dimensions.push({ from, to, label: text(d.label, 30) });
  }

  if (members.length === 0) errors.push('אין במודל אף פרופיל תקין');

  return {
    scene: {
      version: 1,
      title: text(src.title, 120) ?? 'הדמיה',
      material: defMaterial,
      finish: src.finish && typeof src.finish === 'object' ? { color: text(src.finish.color, 20), name: text(src.finish.name) } : undefined,
      members,
      plates,
      parts,
      solids,
      groups,
      dimensions,
      notes: Array.isArray(src.notes) ? src.notes.map((n) => text(n, 300)).filter((n): n is string => Boolean(n)).slice(0, 12) : [],
      source: src.source && text(src.source.url, 300) ? { title: text(src.source.title, 120) ?? '', url: text(src.source.url, 300) as string } : undefined,
    },
    warnings: warnings.slice(0, 40),
    errors,
  };
}

/** Distance along member m (from its `from` end) to the near face of target, or null if it never meets it. */
export function trimDistance(m: Pick<Member, 'from' | 'to' | 'profile' | 'size'>, target: Member): number | null {
  const d = norm(sub(m.to, m.from));
  if (target.via) {
    const arc = arcThrough(target.from, target.via, target.to);
    if (!arc) return null;
    const half = target.size[0] / 2; // radial extent of the arc's section
    const w = sub(m.from, arc.center);
    let best: number | null = null;
    for (const r of [arc.radius - half, arc.radius + half]) {
      const b = dot(w, d);
      const disc = b * b - (dot(w, w) - r * r);
      if (disc < 0) continue;
      for (const s of [-b - Math.sqrt(disc), -b + Math.sqrt(disc)]) {
        if (s <= 1) continue;
        // Only where the arc actually is
        const p = sub(add(m.from, scale(d, s)), arc.center);
        let t = Math.atan2(dot(p, arc.v), dot(p, arc.u));
        if (t < 0) t += 2 * Math.PI;
        if (t > arc.sweep + 1e-6) continue;
        if (best === null || s < best) best = s;
      }
    }
    return best;
  }
  const e = norm(sub(target.to, target.from));
  const b = dot(d, e);
  const denom = 1 - b * b;
  if (denom < 1e-6) return null;
  const w0 = sub(m.from, target.from);
  const s = (b * dot(e, w0) - dot(d, w0)) / denom;
  const t = (dot(e, w0) - b * dot(d, w0)) / denom;
  const tl = len(sub(target.to, target.from));
  if (t < -1 || t > tl + 1) return null;
  const { f, n } = sectionAxes(e);
  const hit = s - halfExtent(target, f, n, d);
  return hit > 1 ? hit : null;
}

// --- Cut list --------------------------------------------------------------------------------------

const PROFILE_SHAPE: Partial<Record<Profile, SteelShape>> = {
  rect_tube: 'rect_tube',
  round_tube: 'round_tube',
  round_bar: 'round_bar',
  square_bar: 'square_bar',
  flat: 'flat',
  angle: 'angle',
};

const j = (...n: number[]) => n.join('/');

/** Same naming as the price-list catalog, so cut-list rows can be matched to price-list items. */
export function sectionName(profile: Profile, size: number[], material: MaterialKey): string {
  const suffix = materialInfo(material)?.suffix ?? '';
  const [a = 0, b = 0, t = 0] = size;
  switch (profile) {
    case 'rect_tube':
      return `פרופיל ${j(Math.max(a, b), Math.min(a, b), t)}${suffix}`;
    case 'angle':
      return `זוויתן ${j(Math.max(a, b), Math.min(a, b), t)}${suffix}`;
    case 'round_tube':
      return INCH[String(a)] ? `צינור ${INCH[String(a)]} צול (${j(a, b)})${suffix}` : `צינור Ø${j(a, b)}${suffix}`;
    case 'round_bar':
      return `מוט עגול Ø${a}${suffix}`;
    case 'square_bar':
      return `מוט מרובע ${j(a, a)}${suffix}`;
    case 'flat':
      return `פלח ${j(a, b)}${suffix}`;
    case 'upn':
      return `פרופיל U ${a}${suffix}`;
    case 'ipe':
      return `קורה IPE ${a}${suffix}`;
    case 'hea':
      return `קורה HEA ${a}${suffix}`;
  }
}

export function kgPerMetre(profile: Profile, size: number[], material: MaterialKey): number {
  const density = materialInfo(material)?.density ?? 7.85;
  const shape = PROFILE_SHAPE[profile];
  if (shape) return kgFor(shape, size, density);
  const beam = BEAMS[profile as 'upn' | 'ipe' | 'hea'][size[0]];
  return beam ? Math.round(((beam.kg * density) / 7.85) * 1000) / 1000 : 0;
}

export interface CutPiece {
  mark: string;
  name: string;
  profile: Profile;
  size: number[];
  material: MaterialKey;
  /** mm, rounded to 1 */
  length: number;
  count: number;
  bent: boolean;
  kg: number;
  ids: string[];
}

export interface CutList {
  pieces: CutPiece[];
  /** Totals per section (what to buy) */
  sections: { name: string; totalMm: number; kg: number; pieces: number }[];
  plates: { name: string; w: number; h: number; count: number; areaM2: number; kg: number }[];
  parts: { kind: PartKind; label: string; count: number }[];
  totalKg: number;
  markOf: Record<string, string>;
}

/** A, B, … Z, AA, AB … */
export function markLabel(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function cutList(scene: ResolvedScene): CutList {
  const groups = new Map<string, CutPiece>();
  for (const m of scene.members) {
    const length = Math.round(memberLength(m));
    const name = sectionName(m.profile, m.size, m.material);
    const key = `${name}|${length}|${m.via ? 'bent' : 'straight'}`;
    let piece = groups.get(key);
    if (!piece) {
      piece = { mark: '', name, profile: m.profile, size: m.size, material: m.material, length, count: 0, bent: Boolean(m.via), kg: 0, ids: [] };
      groups.set(key, piece);
    }
    piece.count++;
    piece.ids.push(m.id);
    piece.kg += (kgPerMetre(m.profile, m.size, m.material) * length) / 1000;
  }
  const pieces = [...groups.values()].sort(
    (a, b) => PROFILES.indexOf(a.profile) - PROFILES.indexOf(b.profile) || a.name.localeCompare(b.name, 'he', { numeric: true }) || b.length - a.length,
  );
  const markOf: Record<string, string> = {};
  pieces.forEach((p, i) => {
    p.mark = markLabel(i);
    p.kg = Math.round(p.kg * 10) / 10;
    for (const id of p.ids) markOf[id] = p.mark;
  });

  const sections = new Map<string, { name: string; totalMm: number; kg: number; pieces: number }>();
  for (const p of pieces) {
    const s = sections.get(p.name) ?? { name: p.name, totalMm: 0, kg: 0, pieces: 0 };
    s.totalMm += p.length * p.count;
    s.kg = Math.round((s.kg + p.kg) * 10) / 10;
    s.pieces += p.count;
    sections.set(p.name, s);
  }

  const plateRows = new Map<string, CutList['plates'][number]>();
  for (const p of scene.plates) {
    const suffix = materialInfo(p.material)?.suffix ?? '';
    const name = `פח ${p.thickness} מ״מ${suffix}`;
    const [w, h] = [Math.round(Math.max(...p.size)), Math.round(Math.min(...p.size))];
    const key = `${name}|${w}|${h}`;
    const row = plateRows.get(key) ?? { name, w, h, count: 0, areaM2: 0, kg: 0 };
    row.count++;
    row.areaM2 = Math.round(((row.count * w * h) / 1e6) * 100) / 100;
    row.kg = Math.round(row.areaM2 * kgFor('plate', [p.thickness], materialInfo(p.material)?.density ?? 7.85) * 10) / 10;
    plateRows.set(key, row);
  }

  const partRows = new Map<string, CutList['parts'][number]>();
  for (const p of scene.parts) {
    if (p.kind === 'footing') continue;
    const label = p.label ?? PART_LABELS[p.kind];
    const row = partRows.get(label) ?? { kind: p.kind, label, count: 0 };
    row.count++;
    partRows.set(label, row);
  }

  const plateList = [...plateRows.values()];
  const totalKg = Math.round((pieces.reduce((s, p) => s + p.kg, 0) + plateList.reduce((s, p) => s + p.kg, 0)) * 10) / 10;
  return { pieces, sections: [...sections.values()], plates: plateList, parts: [...partRows.values()], totalKg, markOf };
}

/** Metal extent (mm) – walls, paving and footings left out. */
export function metalBounds(scene: ResolvedScene): { min: Vec3; max: Vec3 } {
  return boundsOf(scene.members, scene.plates);
}

/** The fabricated work: moving leaves and anything standing up. A long ground track is left out. */
export function workBounds(scene: ResolvedScene): { min: Vec3; max: Vec3 } {
  const focus = scene.members.filter((m) => m.group || Math.max(m.from[1], m.to[1], m.via?.[1] ?? -Infinity) > 100);
  return boundsOf(focus.length > 0 ? focus : scene.members, scene.plates);
}

/** Extent of some members (and plates), padded across each member only. */
export function boundsOf(members: Member[], plates: Pick<Plate, 'center' | 'size'>[] = []): { min: Vec3; max: Vec3 } {
  const scene = { members, plates };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: Vec3, r = 0) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i] - r);
      max[i] = Math.max(max[i], p[i] + r);
    }
  };
  for (const m of scene.members) {
    const r = Math.max(...m.size.slice(0, 2)) / 2;
    if (m.via) {
      const arc = arcThrough(m.from, m.via, m.to);
      for (let i = 0; i <= 16; i++) grow(arc ? arcPoint(arc, i / 16) : m.from, r);
      continue;
    }
    // Pad across the member only, so a post's bottom is where it really ends
    const { f, n } = sectionAxes(sub(m.to, m.from));
    for (const end of [m.from, m.to]) {
      for (const sf of [-r, r]) for (const sn of [-r, r]) grow(add(end, add(scale(f, sf), scale(n, sn))));
    }
  }
  for (const p of scene.plates) grow(p.center, Math.max(...p.size) / 2);
  return { min, max };
}

/** A dimension's label is a name ("פתח", "קטע מוחלף"); a number in it would go stale when the layout changes. */
export function dimensionName(label: string | null | undefined): string | null {
  const t = label?.trim();
  return t && !/\d/.test(t) ? t : null;
}

export interface DimensionLine {
  from: Vec3;
  to: Vec3;
  /** Measured length, mm */
  mm: number;
  name: string | null;
  axis: Axis;
}

/**
 * What the 3D view measures, always from the geometry: each moving leaf, the overall width and height,
 * and the layout's own extra dimensions.
 */
export function dimensionLines(scene: ResolvedScene): DimensionLine[] {
  const b = workBounds(scene);
  const out: DimensionLine[] = [];
  const front = b.max[2] + 350;
  const leaves = scene.groups
    .map((g) => scene.members.filter((m) => m.group === g.id))
    .filter((ms) => ms.length > 0)
    .map((ms) => boundsOf(ms));
  for (const lb of leaves) {
    out.push({ from: [lb.min[0], 15, front], to: [lb.max[0], 15, front], mm: Math.round(lb.max[0] - lb.min[0]), name: null, axis: 'x' });
  }
  const overallZ = leaves.length > 0 ? front + 400 : front;
  out.push({ from: [b.min[0], 15, overallZ], to: [b.max[0], 15, overallZ], mm: Math.round(b.max[0] - b.min[0]), name: null, axis: 'x' });
  out.push({ from: [b.max[0] + 350, 0, 0], to: [b.max[0] + 350, b.max[1], 0], mm: Math.round(b.max[1]), name: null, axis: 'y' });
  for (const d of scene.dimensions ?? []) {
    const v = sub(d.to, d.from);
    const axis: Axis = Math.abs(v[1]) >= Math.abs(v[0]) && Math.abs(v[1]) >= Math.abs(v[2]) ? 'y' : Math.abs(v[0]) >= Math.abs(v[2]) ? 'x' : 'z';
    out.push({ from: d.from, to: d.to, mm: Math.round(len(v)), name: dimensionName(d.label), axis });
  }
  return out;
}
