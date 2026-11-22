/**
 * The built-in catalog: standard sizes per family and material, with weights.
 * It is imported into the price list once (and again after new sizes are added here);
 * prices come from the per-kg price of each material, or are set by the user.
 *
 * To add sizes: add them to the lists below. Keys must stay stable once released.
 */
import { kgFor } from './steel.ts';
import { BEAMS, beamSizes } from './sections.ts';
import type { SteelShape } from './steel.ts';
import type { ElementCategory, Unit } from './types.ts';
import { SHEETS } from './sheets.ts';
import type { Profile } from './scene.ts';

export type MaterialKey = 'black' | 'galv' | 'stainless' | 'aluminum';

export const MATERIALS: { key: MaterialKey; name: string; short: string; suffix: string; density: number }[] = [
  { key: 'black', name: 'ברזל שחור', short: 'שחור', suffix: '', density: 7.85 },
  { key: 'galv', name: 'ברזל מגולוון', short: 'מגולוון', suffix: ' מגולוון', density: 7.85 },
  { key: 'stainless', name: 'נירוסטה 304', short: 'נירוסטה', suffix: ' נירוסטה', density: 7.93 },
  { key: 'aluminum', name: 'אלומיניום', short: 'אלומיניום', suffix: ' אלומיניום', density: 2.7 },
];
export const MATERIAL_KEYS = MATERIALS.map((m) => m.key);
export const materialInfo = (key: string | null | undefined) => MATERIALS.find((m) => m.key === key) ?? null;

export interface CatalogItem {
  /** Stable id, e.g. "rect:galv:60x40x2" */
  key: string;
  category: ElementCategory;
  family: string;
  name: string;
  /** Short label for the size grid ("60/40/2"); null for non-steel items */
  size: string | null;
  unit: Unit;
  material: MaterialKey | null;
  /** kg per unit (per m, or per m² for plate) */
  weight: number | null;
  stock: number | null;
  /** 1 = price follows weight × material price per kg */
  by_kg: 0 | 1;
}

/** Families in menu order. `shape` lets the "add size" form compute names and weights. */
export interface FamilyDef {
  category: ElementCategory;
  family: string;
  shape: SteelShape | null;
  /** Word the item name starts with ("פרופיל", "זוויתן") */
  base: string;
  unit: Unit;
  stock: number | null;
}

/**
 * Dimensions are joined with "/" ("60/40/2"), as the trade writes them. Unlike "×", "/" between digits
 * keeps the number in left-to-right order inside Hebrew text; no ″ ° ½ next to digits for the same reason.
 */
const x = (...n: number[]) => n.map((v) => String(v)).join('/');
const keyDims = (...n: number[]) => n.map((v) => String(v)).join('x');

export const FAMILIES: FamilyDef[] = [
  { category: 'profile', family: 'פרופיל מרובע', shape: 'rect_tube', base: 'פרופיל', unit: 'm', stock: 6000 },
  { category: 'profile', family: 'פרופיל מלבני', shape: 'rect_tube', base: 'פרופיל', unit: 'm', stock: 6000 },
  { category: 'profile', family: 'זוויתן', shape: 'angle', base: 'זוויתן', unit: 'm', stock: 6000 },
  { category: 'profile', family: 'פלח', shape: 'flat', base: 'פלח', unit: 'm', stock: 6000 },
  { category: 'profile', family: 'מוט עגול', shape: 'round_bar', base: 'מוט עגול', unit: 'm', stock: 6000 },
  { category: 'profile', family: 'מוט מרובע', shape: 'square_bar', base: 'מוט מרובע', unit: 'm', stock: 6000 },
  { category: 'profile', family: 'פרופיל U (UPN)', shape: null, base: 'פרופיל U', unit: 'm', stock: 6000 },
  { category: 'profile', family: 'קורה IPE', shape: null, base: 'קורה IPE', unit: 'm', stock: 12000 },
  { category: 'profile', family: 'קורה HEA', shape: null, base: 'קורה HEA', unit: 'm', stock: 12000 },
  { category: 'pipe', family: 'צינור עגול לקונסטרוקציה', shape: 'round_tube', base: 'צינור', unit: 'm', stock: 6000 },
  { category: 'pipe', family: 'צינור פלדה לקווי מים', shape: 'round_tube', base: 'צינור פלדה', unit: 'm', stock: 12000 },
  { category: 'plate', family: 'פח חלק', shape: 'plate', base: 'פח', unit: 'm2', stock: null },
  { category: 'plate', family: 'פח מרוג (דריכה)', shape: null, base: 'פח מרוג', unit: 'm2', stock: null },
  { category: 'plate', family: 'קירוי: סנטף ופוליקרבונט', shape: null, base: '', unit: 'm2', stock: null },
  { category: 'fitting', family: 'קשתות', shape: null, base: 'קשת', unit: 'unit', stock: null },
  { category: 'fitting', family: 'הסתעפויות ומעברים', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'fitting', family: 'אוגנים ואטמים', shape: null, base: 'אוגן', unit: 'unit', stock: null },
  { category: 'hardware', family: 'צירים', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'hardware', family: 'שער הזזה', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'hardware', family: 'מנעולים ובריחים', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'hardware', family: 'ידיות, עוצרים ומחזירים', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'hardware', family: 'עיגון וברגים', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'weld', family: 'ריתוך צנרת (לתפר)', shape: null, base: 'תפר ריתוך', unit: 'joint', stock: null },
  { category: 'labor', family: 'עבודה', shape: null, base: '', unit: 'hour', stock: null },
  { category: 'finish', family: 'צביעה', shape: null, base: '', unit: 'm2', stock: null },
  { category: 'finish', family: 'גלוון וניקוי', shape: null, base: '', unit: 'kg', stock: null },
  { category: 'finish', family: 'צבעים וחומרים', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'equipment', family: 'ציוד וכלים', shape: null, base: '', unit: 'day', stock: null },
  { category: 'other', family: 'מתכלים לריתוך', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'other', family: 'דיסקים ומברשות', shape: null, base: '', unit: 'unit', stock: null },
  { category: 'other', family: 'הובלה ושטח', shape: null, base: '', unit: 'unit', stock: null },
];

export const familyDef = (family: string | null | undefined) => FAMILIES.find((f) => f.family === family) ?? null;
export const familyOrder = (family: string | null | undefined) => {
  const i = FAMILIES.findIndex((f) => f.family === family);
  return i < 0 ? FAMILIES.length : i;
};

/** "פרופיל 60/40/2 מגולוון" */
export function itemName(base: string, size: string, material: MaterialKey | null): string {
  return `${base} ${size}${materialInfo(material)?.suffix ?? ''}`;
}

// --- Sizes. [a, b, [thicknesses]] ---
const SQUARE: [number, number[]][] = [
  [15, [1.5]], [20, [1.5, 2]], [25, [1.5, 2]], [30, [1.5, 2, 3]], [35, [2]], [40, [1.5, 2, 3]], [50, [2, 3, 4]],
  [60, [2, 3, 4]], [70, [3]], [80, [2, 3, 4]], [100, [3, 4, 5]], [120, [4, 5]], [150, [4, 5, 6]],
];
const RECT: [number, number, number[]][] = [
  [20, 10, [1.5]], [30, 15, [1.5]], [30, 20, [1.5, 2]], [40, 20, [1.5, 2]], [40, 30, [2]], [50, 20, [2]], [50, 25, [2]],
  [50, 30, [2, 3]], [60, 20, [2]], [60, 30, [2, 3]], [60, 40, [2, 3]], [80, 40, [2, 3]], [80, 60, [3]], [100, 40, [2, 3]],
  [100, 50, [3, 4]], [100, 60, [3]], [120, 40, [3]], [120, 60, [3, 4]], [120, 80, [4]], [150, 50, [3, 4]],
  [150, 100, [4, 5]], [200, 100, [5, 6]],
];
const SQUARE_STAINLESS: [number, number[]][] = [[20, [1.5]], [25, [1.5]], [30, [1.5, 2]], [40, [1.5, 2]], [50, [2]], [60, [2]]];
const RECT_STAINLESS: [number, number, number[]][] = [[30, 20, [1.5]], [40, 20, [1.5, 2]], [50, 25, [1.5]], [60, 30, [2]], [60, 40, [2]], [80, 40, [2]]];
const SQUARE_ALU: [number, number[]][] = [[20, [2]], [25, [2]], [30, [2]], [40, [2]], [50, [3]]];
const RECT_ALU: [number, number, number[]][] = [[40, 20, [2]], [50, 25, [2]], [60, 30, [2]], [80, 40, [3]]];

const ANGLE: [number, number][] = [
  [20, 3], [25, 3], [30, 3], [30, 4], [35, 4], [40, 4], [40, 5], [45, 5], [50, 5], [50, 6], [60, 6], [70, 7], [80, 8], [100, 10],
];
const ANGLE_STAINLESS: [number, number][] = [[20, 3], [25, 3], [30, 3], [40, 4], [50, 5]];
const ANGLE_ALU: [number, number][] = [[20, 2], [25, 2], [30, 3], [40, 4]];

const FLAT: [number, number][] = [
  [20, 3], [20, 5], [25, 3], [25, 5], [30, 3], [30, 5], [30, 8], [40, 4], [40, 5], [40, 8], [40, 10], [50, 5], [50, 8],
  [50, 10], [60, 6], [60, 10], [80, 8], [80, 10], [100, 10], [100, 12], [120, 10], [150, 10],
];
const FLAT_STAINLESS: [number, number][] = [[20, 3], [25, 3], [30, 3], [40, 4], [40, 5], [50, 5]];
const FLAT_ALU: [number, number][] = [[20, 3], [30, 3], [40, 4], [50, 5]];

const ROUND_BAR = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 50];
const ROUND_BAR_STAINLESS = [6, 8, 10, 12, 16, 20];
const SQUARE_BAR = [10, 12, 14, 16, 20, 25];

/** The standard sizes of a profile in a material, as layout sizes (for suggesting a stronger one) */
export function standardSizes(profile: Profile, material: MaterialKey): number[][] {
  const st = material === 'stainless';
  const al = material === 'aluminum';
  switch (profile) {
    case 'rect_tube':
      return [
        ...(st ? SQUARE_STAINLESS : al ? SQUARE_ALU : SQUARE).flatMap(([a, ts]) => ts.map((t) => [a, a, t])),
        ...(st ? RECT_STAINLESS : al ? RECT_ALU : RECT).flatMap(([a, b, ts]) => ts.map((t) => [a, b, t])),
      ];
    case 'angle':
      return (st ? ANGLE_STAINLESS : al ? ANGLE_ALU : ANGLE).map(([a, t]) => [a, a, t]);
    case 'flat':
      return (st ? FLAT_STAINLESS : al ? FLAT_ALU : FLAT).map(([w, t]) => [w, t]);
    case 'round_bar':
      return (st ? ROUND_BAR_STAINLESS : ROUND_BAR).map((d) => [d]);
    case 'square_bar':
      return SQUARE_BAR.map((a) => [a]);
    case 'round_tube':
      return (st ? ROUND_TUBE_STAINLESS : ROUND_TUBE).map(([d, t]) => [d, t]);
    case 'upn':
    case 'ipe':
    case 'hea':
      return beamSizes(profile).map((h) => [h]);
  }
}

/** Outside diameter → nominal size in inches (צול) */
export const INCH: Record<string, string> = {
  '21.3': '0.5', '26.9': '0.75', '33.7': '1', '42.4': '1.25', '48.3': '1.5', '60.3': '2', '76.1': '2.5', '88.9': '3',
  '101.6': '3.5', '114.3': '4', '168.3': '6', '219.1': '8', '273': '10', '323.9': '12', '355.6': '14',
  '406.4': '16', '508': '20', '609.6': '24',
};
const ROUND_TUBE: [number, number][] = [
  [21.3, 2], [26.9, 2], [33.7, 2], [33.7, 2.6], [42.4, 2], [42.4, 2.6], [48.3, 2], [48.3, 2.9], [60.3, 2], [60.3, 2.9],
  [76.1, 2.9], [88.9, 3.2], [101.6, 3.6], [114.3, 3.6],
];
const ROUND_TUBE_STAINLESS: [number, number][] = [[25.4, 1.5], [38.1, 1.5], [42.4, 2], [48.3, 2], [50.8, 2]];
const WATER_PIPE: [number, number][] = [
  [60.3, 3.9], [88.9, 4], [114.3, 4], [168.3, 4.5], [219.1, 4.8], [219.1, 6.35], [273, 6.35], [323.9, 6.35],
  [355.6, 6.35], [406.4, 6.35], [508, 7.92], [609.6, 7.92],
];

/** Table weights (kg/m) for rolled sections */
const table = (t: 'upn' | 'ipe' | 'hea'): [number, number][] => beamSizes(t).map((h) => [h, BEAMS[t][h].kg]);
const UPN = table('upn');
const IPE = table('ipe');
const HEA = table('hea');

const PLATE: Record<MaterialKey, number[]> = {
  black: [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25],
  galv: [0.5, 0.75, 1, 1.25, 1.5, 2, 3],
  stainless: [0.8, 1, 1.5, 2, 3, 4, 5],
  aluminum: [1, 1.5, 2, 3, 4, 5],
};
const TREAD_PLATE = [3, 4, 5, 6];

/** Nominal pipe sizes for fittings */
const FITTING_SIZES = ['2', '3', '4', '6', '8', '10', '12', '16'];

function steel(
  out: CatalogItem[],
  family: string,
  material: MaterialKey,
  keyPrefix: string,
  size: string,
  dimsKey: string,
  weight: number,
  nameOverride?: string,
): void {
  const def = familyDef(family) as FamilyDef;
  out.push({
    key: `${keyPrefix}:${material}:${dimsKey}`,
    category: def.category,
    family,
    name: nameOverride ?? itemName(def.base, size, material),
    size,
    unit: def.unit,
    material,
    weight,
    stock: def.stock,
    by_kg: 1,
  });
}

function plain(out: CatalogItem[], family: string, key: string, name: string, unit?: Unit): void {
  const def = familyDef(family) as FamilyDef;
  out.push({ key: `item:${key}`, category: def.category, family, name, size: null, unit: unit ?? def.unit, material: null, weight: null, stock: null, by_kg: 0 });
}

const density = (m: MaterialKey) => materialInfo(m)?.density ?? 7.85;

export function catalogItems(): CatalogItem[] {
  const out: CatalogItem[] = [];

  const tubes = (family: string, prefix: string, list: [number, number, number[]][], mats: MaterialKey[], maxT = 99) => {
    for (const m of mats) {
      for (const [a, b, ts] of list) {
        for (const t of ts) {
          if (t > maxT && m === 'galv') continue;
          steel(out, family, m, prefix, x(a, b, t), keyDims(a, b, t), kgFor('rect_tube', [a, b, t], density(m)));
        }
      }
    }
  };
  const sq = (l: [number, number[]][]) => l.map(([a, ts]) => [a, a, ts] as [number, number, number[]]);
  tubes('פרופיל מרובע', 'sq', sq(SQUARE), ['black', 'galv'], 4);
  tubes('פרופיל מרובע', 'sq', sq(SQUARE_STAINLESS), ['stainless']);
  tubes('פרופיל מרובע', 'sq', sq(SQUARE_ALU), ['aluminum']);
  tubes('פרופיל מלבני', 'rect', RECT, ['black', 'galv'], 4);
  tubes('פרופיל מלבני', 'rect', RECT_STAINLESS, ['stainless']);
  tubes('פרופיל מלבני', 'rect', RECT_ALU, ['aluminum']);

  const angles = (list: [number, number][], m: MaterialKey) => {
    for (const [a, t] of list) steel(out, 'זוויתן', m, 'angle', x(a, a, t), keyDims(a, a, t), kgFor('angle', [a, a, t], density(m)));
  };
  angles(ANGLE, 'black');
  angles(ANGLE.filter(([a]) => a <= 60), 'galv');
  angles(ANGLE_STAINLESS, 'stainless');
  angles(ANGLE_ALU, 'aluminum');

  const flats = (list: [number, number][], m: MaterialKey) => {
    for (const [w, t] of list) steel(out, 'פלח', m, 'flat', x(w, t), keyDims(w, t), kgFor('flat', [w, t], density(m)));
  };
  flats(FLAT, 'black');
  flats(FLAT.filter(([w, t]) => w <= 100 && t <= 8), 'galv');
  flats(FLAT_STAINLESS, 'stainless');
  flats(FLAT_ALU, 'aluminum');

  for (const d of ROUND_BAR) steel(out, 'מוט עגול', 'black', 'rbar', `Ø${d}`, keyDims(d), kgFor('round_bar', [d]));
  for (const d of ROUND_BAR_STAINLESS) steel(out, 'מוט עגול', 'stainless', 'rbar', `Ø${d}`, keyDims(d), kgFor('round_bar', [d], 7.93));
  for (const a of SQUARE_BAR) steel(out, 'מוט מרובע', 'black', 'sbar', x(a, a), keyDims(a), kgFor('square_bar', [a]));

  for (const [h, kg] of UPN) steel(out, 'פרופיל U (UPN)', 'black', 'upn', String(h), keyDims(h), kg);
  for (const [h, kg] of IPE) steel(out, 'קורה IPE', 'black', 'ipe', String(h), keyDims(h), kg);
  for (const [h, kg] of HEA) steel(out, 'קורה HEA', 'black', 'hea', String(h), keyDims(h), kg);

  // Size chip: "2 צול, 2.9" (nominal size, wall); name: "צינור 2 צול (60.3/2.9)"
  const inchSize = (od: number, t: number) => `${INCH[String(od)]} צול, ${t}`;
  const inchName = (base: string, od: number, t: number, m: MaterialKey) =>
    `${base} ${INCH[String(od)]} צול (${x(od, t)})${materialInfo(m)?.suffix ?? ''}`;
  for (const m of ['black', 'galv'] as MaterialKey[]) {
    for (const [od, t] of ROUND_TUBE) {
      steel(out, 'צינור עגול לקונסטרוקציה', m, 'tube', inchSize(od, t), keyDims(od, t), kgFor('round_tube', [od, t]), inchName('צינור', od, t, m));
    }
  }
  for (const [od, t] of ROUND_TUBE_STAINLESS) {
    steel(out, 'צינור עגול לקונסטרוקציה', 'stainless', 'tube', `Ø${x(od, t)}`, keyDims(od, t), kgFor('round_tube', [od, t], 7.93));
  }
  for (const [od, t] of WATER_PIPE) {
    steel(out, 'צינור פלדה לקווי מים', 'black', 'water', inchSize(od, t), keyDims(od, t), kgFor('round_tube', [od, t]), inchName('צינור פלדה', od, t, 'black'));
  }

  for (const m of MATERIAL_KEYS) {
    for (const t of PLATE[m]) steel(out, 'פח חלק', m, 'plate', `${t} מ״מ`, keyDims(t), kgFor('plate', [t], density(m)));
  }
  for (const t of TREAD_PLATE) {
    steel(out, 'פח מרוג (דריכה)', 'black', 'tread', `${t} מ״מ`, keyDims(t), Math.round((t * 7.85 + 2) * 1000) / 1000);
  }
  // Roofing sheets (סנטף), priced per m² whatever the tint; the layout's plates find them by key (sheet:<key>)
  for (const sh of SHEETS) {
    out.push({ key: `sheet:${sh.key}`, category: 'plate', family: 'קירוי: סנטף ופוליקרבונט', name: sh.name, size: sh.short, unit: 'm2', material: null, weight: sh.kgPerM2, stock: null, by_kg: 0 });
  }

  // --- Pipe fittings for welding (price per piece, set by the user)
  for (const s of FITTING_SIZES) {
    const k = `${s}in`;
    plain(out, 'קשתות', `elbow90:${k}`, `קשת 90 מעלות ${s} צול לריתוך`);
    plain(out, 'קשתות', `elbow45:${k}`, `קשת 45 מעלות ${s} צול לריתוך`);
    plain(out, 'הסתעפויות ומעברים', `tee:${k}`, `T שווה ${s} צול לריתוך`);
    plain(out, 'הסתעפויות ומעברים', `cap:${k}`, `פקק (כיפה) ${s} צול לריתוך`);
    plain(out, 'אוגנים ואטמים', `flange:${k}`, `אוגן ${s} צול לריתוך PN16`);
    plain(out, 'אוגנים ואטמים', `blind:${k}`, `אוגן עיוור ${s} צול PN16`);
    plain(out, 'אוגנים ואטמים', `gasket:${k}`, `אטם + ברגים לאוגן ${s} צול`);
    plain(out, 'ריתוך צנרת (לתפר)', `joint:${k}`, `תפר ריתוך צנרת ${s} צול`);
  }
  for (const [a, b] of [[4, 3], [6, 4], [8, 6], [10, 8], [12, 10]]) {
    plain(out, 'הסתעפויות ומעברים', `reducer:${a}in-${b}in`, `מעבר קונצנטרי ${x(a, b)} צול`);
  }

  // --- Hardware
  const hw: [string, string, string][] = [
    ['צירים', 'hinge-weld-16', 'ציר ריתוך (חבית) 16 מ״מ'],
    ['צירים', 'hinge-weld-20', 'ציר ריתוך (חבית) 20 מ״מ'],
    ['צירים', 'hinge-weld-25', 'ציר ריתוך (חבית) 25 מ״מ'],
    ['צירים', 'hinge-heavy', 'ציר כבד לשער'],
    ['צירים', 'hinge-adjust', 'ציר מתכוונן לשער'],
    ['צירים', 'hinge-bearing', 'ציר עם מיסב לשער כבד'],
    ['שער הזזה', 'wheel-v-80', 'גלגל לשער הזזה 80 מ״מ (חריץ V)'],
    ['שער הזזה', 'wheel-v-100', 'גלגל לשער הזזה 100 מ״מ (חריץ V)'],
    ['שער הזזה', 'wheel-v-120', 'גלגל לשער הזזה 120 מ״מ (חריץ V)'],
    ['שער הזזה', 'guide-top', 'מוביל עליון עם גלגלות'],
    ['שער הזזה', 'stopper', 'עוצר סוף מסלול'],
    ['שער הזזה', 'catcher', 'תופס קצה לשער הזזה'],
    ['שער הזזה', 'motor', 'מנוע לשער הזזה (כולל שלטים)'],
    ['מנעולים ובריחים', 'lock-gate', 'מנעול שער + ידית'],
    ['מנעולים ובריחים', 'lock-weld', 'מנעול ריתוך למסגרות'],
    ['מנעולים ובריחים', 'cylinder', 'צילינדר למנעול'],
    ['מנעולים ובריחים', 'bolt-floor', 'בריח רצפה'],
    ['מנעולים ובריחים', 'bolt-weld', 'בריח ריתוך'],
    ['מנעולים ובריחים', 'latch', 'תפס סגירה לשער'],
    ['מנעולים ובריחים', 'padlock-hasp', 'אוזן למנעול תלייה'],
    ['ידיות, עוצרים ומחזירים', 'handle-pull', 'ידית משיכה'],
    ['ידיות, עוצרים ומחזירים', 'stop-gate', 'עוצר שער לקרקע'],
    ['ידיות, עוצרים ומחזירים', 'closer', 'מחזיר (סוגר) לשער'],
    ['ידיות, עוצרים ומחזירים', 'cap-square', 'פקק פלסטיק לפרופיל'],
    ['ידיות, עוצרים ומחזירים', 'cap-steel', 'כיפה (פקק פלדה) לעמוד'],
    ['עיגון וברגים', 'anchor-m10', 'בורג עיגון (פריקה) M10'],
    ['עיגון וברגים', 'anchor-m12', 'בורג עיגון (פריקה) M12'],
    ['עיגון וברגים', 'chem-cartridge', 'דבק כימי לעיגון (מחסנית)'],
    ['עיגון וברגים', 'threaded-rod', 'מוט הברגה M12 (1 מ׳)'],
    ['עיגון וברגים', 'bolt-set-m12', 'בורג + אום + דסקית M12'],
    ['עיגון וברגים', 'base-plate', 'פלטת בסיס לעמוד 200/200/10'],
  ];
  for (const [fam, key, name] of hw) plain(out, fam, key, name);

  // --- Welding by the joint / labor / equipment
  plain(out, 'עבודה', 'labor-hour', 'שעת עבודה');
  plain(out, 'עבודה', 'labor-helper', 'שעת עוזר');
  plain(out, 'עבודה', 'labor-site', 'שעת עבודה בשטח');
  const eq: [string, string, Unit][] = [
    ['welder-trailer', 'רתכת נגררת + גנרטור – יום', 'day'],
    ['crane-day', 'משאית מנוף – יום', 'day'],
    ['lift-day', 'במת הרמה – יום', 'day'],
    ['scaffold', 'פיגום – יום', 'day'],
    ['excavator-day', 'מחפרון – יום', 'day'],
  ];
  for (const [key, name, unit] of eq) plain(out, 'ציוד וכלים', key, name, unit);

  // --- Finishing
  plain(out, 'צביעה', 'oven-paint', 'צביעה בתנור', 'm2');
  plain(out, 'צביעה', 'site-paint', 'צביעה באתר (יסוד + 2 שכבות)', 'm2');
  plain(out, 'צביעה', 'epoxy-paint', 'צביעה אפוקסית', 'm2');
  plain(out, 'גלוון וניקוי', 'hot-dip', 'גלוון חם (לפי ק״ג ברזל)', 'kg');
  plain(out, 'גלוון וניקוי', 'sandblast', 'התזת חול', 'm2');
  plain(out, 'צבעים וחומרים', 'primer-4l', 'יסוד לברזל (4 ל׳)');
  plain(out, 'צבעים וחומרים', 'topcoat-4l', 'צבע עליון לברזל (4 ל׳)');
  plain(out, 'צבעים וחומרים', 'zinc-spray', 'ספריי אבץ (גלוון קר)');
  plain(out, 'צבעים וחומרים', 'thinner', 'טינר (1 ל׳)');

  // --- Consumables
  const cons: [string, string, string][] = [
    ['מתכלים לריתוך', 'mig-08', 'חוט ריתוך MIG 0.8 מ״מ (סליל 15 ק״ג)'],
    ['מתכלים לריתוך', 'mig-10', 'חוט ריתוך MIG 1.0 מ״מ (סליל 15 ק״ג)'],
    ['מתכלים לריתוך', 'flux-08', 'חוט ריתוך עם ליבה (פלקס) 0.8 מ״מ'],
    ['מתכלים לריתוך', 'electrode-25', 'אלקטרודות 2.5 מ״מ (חבילה)'],
    ['מתכלים לריתוך', 'electrode-32', 'אלקטרודות 3.2 מ״מ (חבילה)'],
    ['מתכלים לריתוך', 'electrode-ss', 'אלקטרודות נירוסטה 2.5 מ״מ (חבילה)'],
    ['מתכלים לריתוך', 'tig-rod', 'מוטות TIG (חבילה)'],
    ['מתכלים לריתוך', 'gas-co2', 'מילוי גז CO₂'],
    ['מתכלים לריתוך', 'gas-mix', 'מילוי גז ארגון / מיקס'],
    ['מתכלים לריתוך', 'tips', 'פיות ומגנים לאקדח ריתוך'],
    ['מתכלים לריתוך', 'consumables-job', 'מתכלים: חוט ריתוך, דיסקים, גז'],
    ['דיסקים ומברשות', 'cut-115', 'דיסק חיתוך 115 מ״מ'],
    ['דיסקים ומברשות', 'cut-125', 'דיסק חיתוך 125 מ״מ'],
    ['דיסקים ומברשות', 'cut-230', 'דיסק חיתוך 230 מ״מ'],
    ['דיסקים ומברשות', 'cut-355', 'דיסק למשור 355 מ״מ'],
    ['דיסקים ומברשות', 'grind-125', 'דיסק השחזה 125 מ״מ'],
    ['דיסקים ומברשות', 'flap-125', 'דיסק פלאפ (ליטוש) 125 מ״מ'],
    ['דיסקים ומברשות', 'wire-brush', 'מברשת פלדה לזווית'],
    ['הובלה ושטח', 'delivery', 'הובלה'],
    ['הובלה ושטח', 'site-arrival', 'הגעה לאתר'],
    ['הובלה ושטח', 'concrete-bag', 'בטון מהיר (שק)'],
    ['הובלה ושטח', 'concrete-m3', 'בטון מובא (קוב)'],
  ];
  for (const [fam, key, name] of cons) plain(out, fam, key, name);

  return out;
}
