/**
 * Ready-made blocks for the hand builder: stairs, a platform, a railing, a ladder and a gate. Each is placed by
 * two grid points and set by a few numbers and profiles. A block gives three kinds of pieces:
 * - frame pieces: centerlines that meet the rest of the frame by the shop's joint rules (design.ts), so a railing
 *   post stops on the beam under it and a gate rail stops at the stile;
 * - pieces with their final shape: stringers, treads, rungs, joists, the deck;
 * - infill between two of its frame pieces (bars of a railing or a gate leaf).
 *
 * Levels are finished floor: the top of stairs and the deck of a platform are at the grid level.
 */
import type { BasePlate, DesignNode, ProfileChoice } from './design.ts';
import { add, arcPoint, arcThrough, dot, halfExtent, len, norm, scale, sectionAxes, sub } from './scene.ts';
import type { Member, Part, Plate, Profile, Vec3 } from './scene.ts';

export type BlockKind = 'stairs' | 'platform' | 'railing' | 'ladder' | 'gate';
export const BLOCK_KINDS: readonly BlockKind[] = ['stairs', 'platform', 'railing', 'ladder', 'gate'];

export interface DesignBlock {
  id: string;
  kind: BlockKind;
  a: DesignNode;
  b: DesignNode;
  params: Record<string, number>;
  profiles: Record<string, ProfileChoice>;
}

type Read = (key: string) => number;

export interface ParamSpec {
  key: string;
  label: string;
  def: number;
  min?: number;
  max?: number;
  options?: { value: number; label: string }[];
  /** Set when the block is placed, not shown */
  hidden?: boolean;
  /** Shown only when this holds */
  when?: (p: Read) => boolean;
}

export interface RoleSpec {
  key: string;
  label: string;
  def: ProfileChoice;
  when?: (p: Read) => boolean;
}

export interface BlockSpec {
  kind: BlockKind;
  label: string;
  /** One line: what the block makes */
  about: string;
  /** One line: how to place it */
  place: string;
  params: ParamSpec[];
  roles: RoleSpec[];
}

const rect = (...size: number[]): ProfileChoice => ({ profile: 'rect_tube', size });
const NONE_ONE_TWO = [
  { value: 0, label: 'בלי' },
  { value: 1, label: 'צד אחד' },
  { value: 2, label: 'שני הצדדים' },
];

export const BLOCKS: Record<BlockKind, BlockSpec> = {
  stairs: {
    kind: 'stairs',
    label: 'מדרגות',
    about: 'לחיים, מדרכי פח ומאחז יד',
    place: 'גע בנקודה התחתונה ואז בעליונה, בחזית או בצד.',
    params: [
      { key: 'width', label: 'רוחב נקי', def: 1000, min: 400, max: 3000 },
      { key: 'maxRiser', label: 'רום מרבי', def: 180, min: 120, max: 250 },
      { key: 'tread', label: 'עובי פח המדרך', def: 5, min: 3, max: 12 },
      { key: 'rails', label: 'מאחז יד', def: 2, options: NONE_ONE_TWO },
    ],
    roles: [
      { key: 'stringer', label: 'לחי', def: { profile: 'upn', size: [160] } },
      { key: 'tread_angle', label: 'זוויתן מתחת למדרך', def: { profile: 'angle', size: [40, 40, 4] } },
      { key: 'rail', label: 'מאחז ועמודים', def: rect(40, 40, 2), when: (p) => p('rails') > 0 },
    ],
  },
  platform: {
    kind: 'platform',
    label: 'במה',
    about: 'קורות היקפיות, קורות משנה, רצפת פח ועמודים',
    place: 'במבט על: גע בשתי פינות נגדיות של הבמה.',
    params: [
      { key: 'deck', label: 'עובי פח הרצפה', def: 5, min: 3, max: 12 },
      { key: 'joist', label: 'מרחק מרבי בין קורות משנה', def: 600, min: 250, max: 1500 },
      {
        key: 'posts',
        label: 'עמודים',
        def: 1,
        options: [
          { value: 0, label: 'בלי' },
          { value: 1, label: 'עד הקרקע' },
        ],
      },
      { key: 'postMax', label: 'מרחק מרבי בין עמודים', def: 3000, min: 1000, max: 8000, when: (p) => p('posts') === 1 },
    ],
    roles: [
      { key: 'beam', label: 'קורה היקפית', def: { profile: 'upn', size: [160] } },
      { key: 'joist', label: 'קורת משנה', def: rect(80, 40, 3) },
      { key: 'post', label: 'עמוד', def: rect(100, 100, 4), when: (p) => p('posts') === 1 },
    ],
  },
  railing: {
    kind: 'railing',
    label: 'מעקה',
    about: 'עמודים, מאחז ומילוי',
    place: 'גע בתחילת המעקה ובסופו, באותו גובה.',
    params: [
      { key: 'height', label: 'גובה', def: 1050, min: 300, max: 2500 },
      { key: 'post', label: 'מרחק מרבי בין עמודים', def: 1500, min: 300, max: 3000 },
      {
        key: 'fill',
        label: 'מילוי',
        def: 0,
        options: [
          { value: 0, label: 'מוטות' },
          { value: 1, label: 'מאחז אמצעי' },
        ],
      },
      { key: 'gap', label: 'רווח מרבי בין מוטות', def: 100, min: 40, max: 250, when: (p) => p('fill') === 0 },
      {
        key: 'toe',
        label: 'פס רגל',
        def: 0,
        options: [
          { value: 0, label: 'בלי' },
          { value: 1, label: 'עם' },
        ],
      },
    ],
    roles: [
      { key: 'post', label: 'עמוד', def: rect(50, 50, 3) },
      { key: 'rail', label: 'מאחז ומסגרת', def: rect(50, 50, 2) },
      { key: 'bar', label: 'מוט מילוי', def: { profile: 'square_bar', size: [14] }, when: (p) => p('fill') === 0 },
      { key: 'toe', label: 'פס רגל', def: { profile: 'flat', size: [100, 5] }, when: (p) => p('toe') === 1 },
    ],
  },
  ladder: {
    kind: 'ladder',
    label: 'סולם',
    about: 'צדדים, שלבים, ומעטפת לפי הצורך',
    place: 'גע בנקודה התחתונה ואז בעליונה, אחת מעל השנייה.',
    params: [
      { key: 'width', label: 'רוחב נקי', def: 450, min: 300, max: 800 },
      { key: 'rung', label: 'מרווח מרבי בין שלבים', def: 280, min: 200, max: 400 },
      { key: 'extend', label: 'המשך מעל הנקודה העליונה', def: 1050, min: 0, max: 1500 },
      {
        key: 'cage',
        label: 'מעטפת',
        def: 0,
        options: [
          { value: 0, label: 'בלי' },
          { value: 1, label: 'מקדימה' },
          { value: 2, label: 'מאחור' },
        ],
      },
      { key: 'across', label: 'כיוון', def: 0, hidden: true },
    ],
    roles: [
      { key: 'rail', label: 'צד', def: { profile: 'flat', size: [60, 10] } },
      { key: 'rung', label: 'שלב', def: { profile: 'round_bar', size: [20] } },
      { key: 'hoop', label: 'חישוק ופסי מעטפת', def: { profile: 'flat', size: [50, 6] }, when: (p) => p('cage') > 0 },
    ],
  },
  gate: {
    kind: 'gate',
    label: 'שער',
    about: 'כנף אחת או שתיים, צירים ומנעול',
    place: 'גע בשתי נקודות העמודים, באותו גובה.',
    params: [
      { key: 'height', label: 'גובה כנף', def: 2000, min: 400, max: 4000 },
      {
        key: 'leaves',
        label: 'כנפיים',
        def: 1,
        options: [
          { value: 1, label: 'אחת' },
          { value: 2, label: 'שתיים' },
        ],
      },
      {
        key: 'posts',
        label: 'עמודים',
        def: 1,
        options: [
          { value: 1, label: 'חדשים' },
          { value: 0, label: 'כבר בשרטוט' },
        ],
      },
      { key: 'under', label: 'מרווח מתחת לכנף', def: 50, min: 0, max: 300 },
      {
        key: 'fill',
        label: 'מילוי',
        def: 0,
        options: [
          { value: 0, label: 'מוטות' },
          { value: 1, label: 'בלי' },
        ],
      },
      { key: 'gap', label: 'רווח מרבי בין מוטות', def: 100, min: 40, max: 250, when: (p) => p('fill') === 0 },
    ],
    roles: [
      { key: 'frame', label: 'מסגרת כנף', def: rect(60, 40, 2) },
      { key: 'bar', label: 'מוט מילוי', def: { profile: 'square_bar', size: [16] }, when: (p) => p('fill') === 0 },
      { key: 'post', label: 'עמוד', def: rect(100, 100, 4), when: (p) => p('posts') === 1 },
    ],
  },
};

/** A block's number, or its default */
export function blockParam(b: Pick<DesignBlock, 'kind' | 'params'>, key: string): number {
  const v = b.params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : (BLOCKS[b.kind].params.find((p) => p.key === key)?.def ?? 0);
}

export function blockProfile(b: Pick<DesignBlock, 'kind' | 'profiles'>, role: string): ProfileChoice {
  return b.profiles[role] ?? BLOCKS[b.kind].roles.find((r) => r.key === role)?.def ?? rect(40, 40, 2);
}

/** Why two grid points can't hold this block, or null */
export function placementError(kind: BlockKind, a: DesignNode, b: DesignNode): string | null {
  const same = (i: 0 | 1 | 2) => a[i] === b[i];
  switch (kind) {
    case 'stairs':
      if (same(1)) return 'מדרגות צריכות נקודה תחתונה ונקודה עליונה.';
      if (same(0) && same(2)) return 'הנקודה העליונה צריכה להיות גם במרחק לרוחב מהתחתונה.';
      if (!same(0) && !same(2)) return 'מדרגות עולות לאורך קו אחד: מסמנים אותן בחזית או בצד.';
      return null;
    case 'ladder':
      if (!same(0) || !same(2)) return 'סולם עולה ישר: גע בנקודה תחתונה ובנקודה שמעליה.';
      if (same(1)) return 'סולם צריך נקודה תחתונה ונקודה עליונה.';
      return null;
    case 'railing':
    case 'gate':
      if (!same(1)) return `${kind === 'gate' ? 'שער' : 'מעקה'} עומד בגובה אחד: גע בשתי נקודות באותו מפלס.`;
      if (same(0) && same(2)) return 'גע בשתי נקודות שונות.';
      return null;
    case 'platform':
      if (!same(1)) return 'במה בגובה אחד: גע בשתי פינות באותו מפלס.';
      if (a[1] === 0) return 'במה צריכה גובה: מסמנים אותה במבט על, במפלס מעל הקרקע.';
      if (same(0) || same(2)) return 'במבט על: גע בשתי פינות נגדיות, לא באותו קו.';
      return null;
  }
}

/** A new block with every number and profile set to its default */
export function newBlock(kind: BlockKind, id: string, a: DesignNode, b: DesignNode, set: Record<string, number> = {}): DesignBlock {
  const spec = BLOCKS[kind];
  const params: Record<string, number> = {};
  for (const p of spec.params) params[p.key] = set[p.key] ?? p.def;
  const profiles: Record<string, ProfileChoice> = {};
  for (const r of spec.roles) profiles[r.key] = r.def;
  return { id, kind, a, b, params, profiles };
}

// ------------------------------------------------------------------------------------------- building

/** A straight piece that meets the frame by the joint rules */
export interface Frame {
  id: string;
  profile: Profile;
  size: number[];
  from: Vec3;
  to: Vec3;
  label?: string;
  base?: BasePlate | null;
  roll?: number;
}

/** Bars between two frame pieces, square to them */
export interface FrameInfill {
  id: string;
  between: [string, string];
  profile: Profile;
  size: number[];
  gap: number;
  label?: string;
}

export interface BlockOutput {
  frames: Frame[];
  members: Member[];
  plates: Plate[];
  parts: Part[];
  infills: FrameInfill[];
  notes: string[];
  /** Short lines for the block's sheet */
  info: string[];
  warn: string | null;
}

const UP: Vec3 = [0, 1, 0];
const level = (v: Vec3): Vec3 => [v[0], 0, v[2]];
const fmt = (x: number) => Math.round(x).toLocaleString('en-US');
const at = (p: Vec3, ...steps: [Vec3, number][]): Vec3 => steps.reduce((q, [d, s]) => add(q, scale(d, s)), p);
/** Half the size of a piece running along `dir`, measured along `along` */
const half = (m: Pick<Member, 'profile' | 'size' | 'roll'>, dir: Vec3, along: Vec3) => {
  const { f, n } = sectionAxes(dir);
  return halfExtent(m, f, n, along);
};
const rep = (count: number, step: Vec3) => (count > 1 ? { repeat: { count, step } } : {});

/** A lying frame piece whose centerline holds point p (a beam a post can stand on) */
export function supportAt(p: Vec3, frames: Frame[]): Frame | null {
  for (const fr of frames) {
    const v = sub(fr.to, fr.from);
    const L = len(v);
    if (L < 1) continue;
    const u = scale(v, 1 / L);
    if (Math.abs(u[1]) > 0.9) continue;
    const t = dot(sub(p, fr.from), u);
    if (t < -0.5 || t > L + 0.5) continue;
    if (len(sub(p, add(fr.from, scale(u, t)))) < 0.5) return fr;
  }
  return null;
}

/** A standing frame piece through point p (a post already drawn) */
function postAt(p: Vec3, frames: Frame[]): Frame | null {
  for (const fr of frames) {
    const v = sub(fr.to, fr.from);
    const L = len(v);
    if (L < 1 || Math.abs(v[1]) / L < 0.99) continue;
    if (Math.hypot(p[0] - fr.from[0], p[2] - fr.from[2]) > 0.5) continue;
    if (p[1] >= Math.min(fr.from[1], fr.to[1]) - 0.5 && p[1] <= Math.max(fr.from[1], fr.to[1]) + 0.5) return fr;
  }
  return null;
}

const empty = (): BlockOutput => ({ frames: [], members: [], plates: [], parts: [], infills: [], notes: [], info: [], warn: null });

/** The pieces of a block whose two points are at pa and pb; `frames` are the frame pieces placed before it */
export function buildBlock(b: DesignBlock, pa: Vec3, pb: Vec3, frames: Frame[]): BlockOutput {
  const p: Read = (k) => blockParam(b, k);
  const role = (k: string) => blockProfile(b, k);
  switch (b.kind) {
    case 'stairs':
      return stairs(b.id, pa, pb, p, role);
    case 'platform':
      return platform(b.id, pa, pb, p, role);
    case 'railing':
      return railing(b.id, pa, pb, p, role, frames);
    case 'ladder':
      return ladder(b.id, pa, pb, p, role);
    case 'gate':
      return gate(b.id, pa, pb, p, role, frames);
  }
}

type Role = (k: string) => ProfileChoice;

function stairs(id: string, pa: Vec3, pb: Vec3, p: Read, role: Role): BlockOutput {
  const out = empty();
  const [lo, hi] = pa[1] <= pb[1] ? [pa, pb] : [pb, pa];
  const H = hi[1] - lo[1];
  const run = level(sub(hi, lo));
  const R = len(run);
  if (H < 1 || R < 1) return out;
  const d = norm(run);
  const c: Vec3 = [d[2], 0, -d[0]];
  const width = p('width');
  const t = p('tread');
  const n = Math.max(2, Math.ceil(H / p('maxRiser') - 1e-9));
  const r = H / n;
  const g = R / (n - 1);
  const tan = r / g;
  const cos = g / Math.hypot(g, r);
  const deg = Math.round((Math.atan(tan) * 180) / Math.PI);
  // x along the run from the first riser, y up from the bottom, s to the side
  const pt = (x: number, y: number, s = 0) => at(lo, [d, x], [UP, y], [c, s]);
  const nosing = (x: number) => (x + g) * tan;
  const step = add(scale(d, g), scale(UP, r));

  // Stringers: the top edge 20 above the nosing line, from the floor to the level
  const stringer = role('stringer');
  const e = norm(step);
  const ax = sectionAxes(e);
  const hd = halfExtent(stringer, ax.f, ax.n, ax.f);
  const hw = halfExtent(stringer, ax.f, ax.n, c);
  const drop = (hd - 20) / cos;
  const yc = (x: number) => nosing(x) - drop;
  const xAt = (y: number) => (y + drop) / tan - g;
  const x0 = xAt(hd / cos);
  const x1 = xAt(H - hd / cos);
  const side = width / 2 + hw;
  if (x1 > x0 + 50) {
    [-side, side].forEach((s, i) =>
      out.members.push({ id: `${id}/stringer${i + 1}`, ...stringer, from: pt(x0, yc(x0), s), to: pt(x1, yc(x1), s), label: 'לחי מדרגות' }),
    );
  }

  // Treads: a plate on two angles, the front edge on the nosing line
  const deep = g + 25;
  out.plates.push({
    id: `${id}/tread`,
    center: pt(deep / 2, r - t / 2),
    size: Math.abs(d[0]) > 0.5 ? [deep, width] : [width, deep],
    normal: 'y',
    thickness: t,
    label: 'מדרך',
    ...rep(n - 1, step),
  });
  const angle = role('tread_angle');
  const aUp = half(angle, c, UP);
  const aD = half(angle, c, d);
  [aD + 5, deep - aD - 5].forEach((x, i) =>
    out.members.push({ id: `${id}/tread_angle${i + 1}`, ...angle, from: pt(x, r - t - aUp, -width / 2), to: pt(x, r - t - aUp, width / 2), label: 'זוויתן מדרך', ...rep(n - 1, step) }),
  );

  // Handrails: posts on the stringers, the rail 900 above the nosing line, a knee rail between the posts
  const sides = p('rails') >= 2 ? [-side, side] : p('rails') === 1 ? [side] : [];
  if (sides.length) {
    const rail = role('rail');
    const xa = g / 2;
    const xb = R - g / 2;
    const count = Math.max(2, Math.ceil((xb - xa) / 1200 - 1e-9) + 1);
    const sp = (xb - xa) / (count - 1);
    const postStep = add(scale(d, sp), scale(UP, sp * tan));
    const railUp = half(rail, e, UP);
    const ph = half(rail, UP, d);
    const top = (x: number) => nosing(x) + 900;
    const onStringer = (x: number) => yc(x) + hd / cos;
    sides.forEach((s, i) => {
      out.members.push({ id: `${id}/post${i + 1}`, ...rail, from: pt(xa, onStringer(xa), s), to: pt(xa, top(xa) - railUp, s), label: 'עמוד מאחז', ...rep(count, postStep) });
      out.members.push({ id: `${id}/handrail${i + 1}`, ...rail, from: pt(xa - 150, top(xa - 150), s), to: pt(xb + 150, top(xb + 150), s), label: 'מאחז יד' });
      const k0 = xa + ph;
      const k1 = xa + sp - ph;
      out.members.push({ id: `${id}/knee${i + 1}`, ...rail, from: pt(k0, nosing(k0) + 450, s), to: pt(k1, nosing(k1) + 450, s), label: 'מאחז אמצעי', ...rep(count - 1, postStep) });
    });
  }

  out.notes.push(`מדרגות: ${n} רומים של ${fmt(r)} מ״מ, שלח ${fmt(g)} מ״מ, שיפוע ${deg} מעלות. הלחיים נחתכות אופקית בקרקע ואנכית למעלה.`);
  out.info.push(`${n} רומים של ${fmt(r)} מ״מ`, `שלח ${fmt(g)} מ״מ, שיפוע ${deg} מעלות`);
  const comfy = (n - 1) * Math.min(320, Math.max(240, 630 - 2 * r));
  const pace = 2 * r + g;
  if (deg > 42 || g < 220) out.warn = `תלול מדי. לנוחות צריך ריצה של כ־${fmt(comfy)} מ״מ.`;
  else if (pace < 580 || pace > 680) out.warn = `הצעד לא נוח (${fmt(pace)} מ״מ, רצוי בין 600 ל־650). ריצה מומלצת: כ־${fmt(comfy)} מ״מ.`;
  return out;
}

function platform(id: string, pa: Vec3, pb: Vec3, p: Read, role: Role): BlockOutput {
  const out = empty();
  const [x0, x1] = [Math.min(pa[0], pb[0]), Math.max(pa[0], pb[0])];
  const [z0, z1] = [Math.min(pa[2], pb[2]), Math.max(pa[2], pb[2])];
  const L = pa[1];
  const t = p('deck');
  const beam = role('beam');
  const joist = role('joist');
  const X: Vec3 = [1, 0, 0];
  const Z: Vec3 = [0, 0, 1];
  const alongX = x1 - x0 >= z1 - z0;
  const long = alongX ? X : Z;
  const short = alongX ? Z : X;
  const yb = L - t - half(beam, long, UP);
  if (yb <= 0 || x1 - x0 < 1 || z1 - z0 < 1) return out;

  // Edge beams on the rectangle's edges, the long ones first (they run through at the corners)
  const P = (x: number, z: number, y = yb): Vec3 => [x, y, z];
  const corners = { a: P(x0, z0), b: P(x1, z0), c: P(x1, z1), d: P(x0, z1) };
  const edges: [Vec3, Vec3][] = alongX
    ? [
        [corners.a, corners.b],
        [corners.d, corners.c],
        [corners.a, corners.d],
        [corners.b, corners.c],
      ]
    : [
        [corners.a, corners.d],
        [corners.b, corners.c],
        [corners.a, corners.b],
        [corners.d, corners.c],
      ];
  edges.forEach(([from, to], i) => out.frames.push({ id: `${id}/edge${i + 1}`, ...beam, from, to, label: 'קורה היקפית' }));

  // Posts down to the ground: at the corners and along the long edges
  const lenLong = alongX ? x1 - x0 : z1 - z0;
  const lenShort = alongX ? z1 - z0 : x1 - x0;
  if (p('posts') === 1) {
    const post = role('post');
    const segs = Math.max(1, Math.ceil(lenLong / p('postMax') - 1e-9));
    let k = 0;
    for (const [from] of edges.slice(0, 2)) {
      for (let i = 0; i <= segs; i++) {
        const top = add(from, scale(long, (i * lenLong) / segs));
        out.frames.push({ id: `${id}/post${++k}`, ...post, from: [top[0], 0, top[2]], to: top, label: 'עמוד במה', base: { w: 200, d: 200, t: 10 } });
      }
    }
  }

  // Joists between the long beams' inner faces, top flush with the beams
  const bh = half(beam, long, short);
  const count = Math.max(0, Math.ceil(lenLong / p('joist') - 1e-9) - 1);
  const js = lenLong / (count + 1);
  const yj = L - t - half(joist, short, UP);
  if (count > 0) {
    const start = add(add(P(x0, z0, yj), scale(long, js)), scale(short, bh));
    out.members.push({ id: `${id}/joist`, ...joist, from: start, to: add(start, scale(short, lenShort - 2 * bh)), label: 'קורת משנה', ...rep(count, scale(long, js)) });
  }

  // The deck over the beams' outer faces
  out.plates.push({ id: `${id}/deck`, center: [(x0 + x1) / 2, L - t / 2, (z0 + z1) / 2], size: [x1 - x0 + 2 * bh, z1 - z0 + 2 * bh], normal: 'y', thickness: t, label: 'רצפת פח' });

  out.notes.push(`במה: רצפת פח ${fmt(t)} מ״מ על קורות משנה כל ${fmt(js)} מ״מ.`);
  out.info.push(`${fmt(x1 - x0)}/${fmt(z1 - z0)} מ״מ, הרצפה בגובה ${fmt(L)}`, count > 0 ? `${count} קורות משנה, כל ${fmt(js)} מ״מ` : 'בלי קורות משנה');
  if (js > 900 && t <= 5) out.warn = `פח של ${fmt(t)} מ״מ על מרווח של ${fmt(js)} מ״מ עלול להתכופף.`;
  return out;
}

function railing(id: string, pa: Vec3, pb: Vec3, p: Read, role: Role, frames: Frame[]): BlockOutput {
  const out = empty();
  const v = sub(pb, pa);
  const L = len(v);
  if (L < 1) return out;
  const d = norm(v);
  const height = p('height');
  const count = Math.max(2, Math.ceil(L / p('post') - 1e-9) + 1);
  const sp = L / (count - 1);
  const post = role('post');
  const rail = role('rail');
  const railUp = half(rail, d, UP);
  // Standing on a beam: heights count from its top
  const under = supportAt(pa, frames) ?? supportAt(pb, frames);
  const base = under ? half(under, norm(sub(under.to, under.from)), UP) * (Math.abs(under.from[1]) < 0.5 && Math.abs(under.to[1]) < 0.5 ? 2 : 1) : 0;
  const yTop = base + height - railUp;
  const top: Frame = { id: `${id}/top`, ...rail, from: at(pa, [UP, yTop]), to: at(pb, [UP, yTop]), label: 'מאחז' };
  out.frames.push(top);
  for (let i = 0; i < count; i++) {
    const foot = at(pa, [d, i * sp]);
    out.frames.push({ id: `${id}/post${i + 1}`, ...post, from: foot, to: at(foot, [UP, yTop]), label: 'עמוד מעקה', base: supportAt(foot, frames) ? null : { w: 150, d: 150, t: 8 } });
  }
  const bay = (i: number, y: number): [Vec3, Vec3] => [at(pa, [d, i * sp], [UP, y]), at(pa, [d, (i + 1) * sp], [UP, y])];
  for (let i = 0; i < count - 1; i++) {
    if (p('fill') === 0) {
      const [from, to] = bay(i, base + 100 + railUp);
      out.frames.push({ id: `${id}/bottom${i + 1}`, ...rail, from, to, label: 'מסגרת תחתונה' });
      out.infills.push({ id: `${id}/bars${i + 1}`, between: [`${id}/bottom${i + 1}`, top.id], ...role('bar'), gap: p('gap'), label: 'מוט מילוי' });
    } else {
      const [from, to] = bay(i, base + height / 2);
      out.frames.push({ id: `${id}/mid${i + 1}`, ...rail, from, to, label: 'מאחז אמצעי' });
    }
    if (p('toe') === 1) {
      const toe = role('toe');
      const [from, to] = bay(i, base + 10 + half(toe, d, UP));
      out.frames.push({ id: `${id}/toe${i + 1}`, ...toe, from, to, label: 'פס רגל' });
    }
  }
  out.info.push(`${count} עמודים, כל ${fmt(sp)} מ״מ`, `אורך ${fmt(L)} מ״מ, גובה ${fmt(height)}`);
  if (height < 1050) out.warn = 'נמוך מ־1,050 מ״מ. כדאי לבדוק מול התקן.';
  else if (p('fill') === 0 && p('gap') > 100) out.warn = 'רווח של יותר מ־100 מ״מ בין המוטות. כדאי לבדוק מול התקן.';
  return out;
}

function ladder(id: string, pa: Vec3, pb: Vec3, p: Read, role: Role): BlockOutput {
  const out = empty();
  const [lo, hi] = pa[1] <= pb[1] ? [pa, pb] : [pb, pa];
  const H = hi[1] - lo[1];
  if (H < 1) return out;
  const alongZ = p('across') === 1;
  const c: Vec3 = alongZ ? [0, 0, 1] : [1, 0, 0];
  const depth: Vec3 = alongZ ? [1, 0, 0] : [0, 0, 1];
  const width = p('width');
  const ext = p('extend');
  // The rails' thin side faces the rungs
  const rail = { ...role('rail'), ...(alongZ ? {} : { roll: 90 }) };
  const rt = half(rail, UP, c);
  const s = width / 2 + rt;
  [-1, 1].forEach((sg, i) => out.members.push({ id: `${id}/rail${i + 1}`, ...rail, from: at(lo, [c, sg * s]), to: at(hi, [UP, ext], [c, sg * s]), label: 'צד סולם' }));

  const count = Math.max(1, Math.ceil(H / p('rung') - 1e-9));
  const sp = H / count;
  const rung = role('rung');
  out.members.push({ id: `${id}/rung`, ...rung, from: at(lo, [UP, sp], [c, -(s + rt)]), to: at(lo, [UP, sp], [c, s + rt]), label: 'שלב', ...rep(count, scale(UP, sp)) });

  const cage = p('cage');
  const y0 = 2300;
  const y1 = H + ext;
  if (cage > 0 && y1 > y0 + 300) {
    const hoop = role('hoop');
    const sg = cage === 1 ? 1 : -1;
    const hoops = Math.max(2, Math.ceil((y1 - y0) / 900 - 1e-9) + 1);
    const hs = (y1 - y0) / (hoops - 1);
    const base = at(lo, [UP, y0]);
    const from = at(base, [c, -s]);
    const to = at(base, [c, s]);
    const via = at(base, [depth, sg * 700]);
    out.members.push({ id: `${id}/hoop`, ...hoop, from, via, to, label: 'חישוק', ...rep(hoops, scale(UP, hs)) });
    const arc = arcThrough(from, via, to);
    if (arc) {
      [0.15, 0.32, 0.5, 0.68, 0.85].forEach((tt, k) => {
        const q = arcPoint(arc, tt);
        out.members.push({ id: `${id}/cage${k + 1}`, ...hoop, from: q, to: at(q, [UP, y1 - y0]), label: 'פס מעטפת' });
      });
    }
  }
  out.info.push(`${count} שלבים, כל ${fmt(sp)} מ״מ`, `גובה ${fmt(H)} מ״מ`);
  if (H > 3000 && cage === 0) out.warn = 'סולם גבוה: כדאי לבדוק אם נדרשת מעטפת.';
  return out;
}

function gate(id: string, pa: Vec3, pb: Vec3, p: Read, role: Role, frames: Frame[]): BlockOutput {
  const out = empty();
  const v = sub(pb, pa);
  const L = len(v);
  if (L < 1) return out;
  const d = norm(v);
  const H = p('height');
  const under = p('under');
  const leaves = p('leaves') === 2 ? 2 : 1;
  const frame = role('frame');

  let ha = 0;
  let hb = 0;
  if (p('posts') === 1) {
    const post = role('post');
    const ph = half(post, UP, d);
    [pa, pb].forEach((q, k) =>
      out.frames.push({ id: `${id}/post${k + 1}`, ...post, from: q, to: at(q, [UP, under + H + 50]), label: 'עמוד שער', base: { w: 200, d: 200, t: 10 } }),
    );
    ha = hb = ph;
  } else {
    const a = postAt(pa, frames);
    const b = postAt(pb, frames);
    ha = a ? half(a, UP, d) : 0;
    hb = b ? half(b, UP, d) : 0;
  }

  const clearance = 10;
  const middle = 10;
  const clear = L - ha - hb;
  const x0 = ha + clearance;
  const w = leaves === 2 ? (clear - 2 * clearance - middle) / 2 : clear - 2 * clearance;
  out.info.push(`פתח נקי ${fmt(clear)} מ״מ`, leaves === 2 ? `שתי כנפיים של ${fmt(w)}/${fmt(H)} מ״מ` : `כנף ${fmt(w)}/${fmt(H)} מ״מ`);
  if (w < 200) {
    out.warn = 'הפתח צר מדי לשער.';
    return out;
  }
  const sh = half(frame, UP, d);
  const rh = half(frame, d, UP);
  const yb = under;
  const yt = under + H;
  const pt = (x: number, y: number) => at(pa, [d, x], [UP, y]);
  for (let k = 0; k < leaves; k++) {
    const s0 = x0 + k * (w + middle);
    const s1 = s0 + w;
    const leaf = `${id}/leaf${k + 1}`;
    out.frames.push(
      { id: `${leaf}-stile1`, ...frame, from: pt(s0 + sh, yb), to: pt(s0 + sh, yt), label: 'מסגרת כנף' },
      { id: `${leaf}-stile2`, ...frame, from: pt(s1 - sh, yb), to: pt(s1 - sh, yt), label: 'מסגרת כנף' },
      { id: `${leaf}-bottom`, ...frame, from: pt(s0 + sh, yb + rh), to: pt(s1 - sh, yb + rh), label: 'מסגרת כנף' },
      { id: `${leaf}-top`, ...frame, from: pt(s0 + sh, yt - rh), to: pt(s1 - sh, yt - rh), label: 'מסגרת כנף' },
    );
    if (p('fill') === 0) out.infills.push({ id: `${leaf}-bars`, between: [`${leaf}-bottom`, `${leaf}-top`], ...role('bar'), gap: p('gap'), label: 'מוט מילוי' });
    const hinge = k === 0 ? s0 : s1;
    out.parts.push({ id: `${leaf}-hinge`, kind: 'hinge', at: pt(hinge, yb + 200), axis: 'y', repeat: { count: 2, step: scale(UP, H - 400) } });
  }
  const latch = x0 + w;
  out.parts.push({ id: `${id}/lock`, kind: 'lock', at: pt(latch, Math.min(yb + 1000, yt - 100)) });
  if (leaves === 2) out.parts.push({ id: `${id}/drop_bolt`, kind: 'drop_bolt', at: pt(latch + middle + 60, yb + 100) });
  if (leaves === 1 && w > 2500) out.warn = 'כנף רחבה מ־2.5 מטר: כדאי שתי כנפיים או שער הזזה.';
  return out;
}
