/**
 * Roofing and cladding sheets for canopies and pergolas ("סנטף" in the trade): corrugated and trapezoid
 * polycarbonate, corrugated PVC, multiwall and solid polycarbonate. A plate in a design or layout can be one of these
 * instead of steel: it keeps its rectangle, takes its thickness, weight and look from here, and is priced per m².
 *
 * Figures are the makers' published ones (Palram SUNTUF / PALRUF, Polygal) where given; the spans between purlins are
 * for about 1 kPa of load and are a reminder, not a design check. Keys must stay stable once released (catalog keys,
 * saved designs).
 */

export type SheetKey =
  | 'pc_trapeze'
  | 'pc_corrugated'
  | 'pvc_corrugated'
  | 'pc_multiwall_6'
  | 'pc_multiwall_8'
  | 'pc_multiwall_10'
  | 'pc_multiwall_16'
  | 'pc_solid_3'
  | 'pc_solid_5';

export type SheetTint = 'clear' | 'bronze' | 'opal' | 'gray';

export interface SheetDef {
  key: SheetKey;
  /** Menu and price-list name, without the tint */
  name: string;
  /** Short label for the menu and the size chip */
  short: string;
  /** Sheet thickness, mm */
  thickness: number;
  /** Height of the profile (wave or cells): how much room it takes on the frame, mm */
  depth: number;
  kgPerM2: number;
  /** Width of one sheet and the width it covers once overlapped, mm, when the maker gives them */
  width?: number;
  cover?: number;
  /** Largest distance between purlins, mm: between inner purlins, and from the edge to the first one */
  purlin?: { mid: number; end: number };
  /** Least roof slope, degrees */
  minPitch?: number;
  tints: SheetTint[];
}

export const SHEETS: SheetDef[] = [
  {
    key: 'pc_trapeze',
    name: 'סנטף מלבני (טרפז 76/16), פוליקרבונט 0.8 מ״מ',
    short: 'סנטף מלבני',
    thickness: 0.8,
    depth: 16,
    kgPerM2: 1.1,
    width: 1260,
    cover: 1216,
    purlin: { mid: 1200, end: 900 },
    minPitch: 5,
    tints: ['clear', 'bronze', 'opal', 'gray'],
  },
  {
    key: 'pc_corrugated',
    name: 'סנטף גלי (איסכורית 76/18), פוליקרבונט 1 מ״מ',
    short: 'סנטף גלי',
    thickness: 1,
    depth: 18,
    kgPerM2: 1.4,
    width: 1063,
    purlin: { mid: 1000, end: 800 },
    minPitch: 5,
    tints: ['clear', 'bronze', 'opal', 'gray'],
  },
  {
    key: 'pvc_corrugated',
    name: 'פלרוף PVC גלי 1 מ״מ',
    short: 'PVC גלי',
    thickness: 1,
    depth: 18,
    kgPerM2: 1.6,
    minPitch: 5,
    tints: ['clear', 'opal', 'gray'],
  },
  ...([6, 8, 10, 16] as const).map(
    (t): SheetDef => ({
      key: `pc_multiwall_${t}`,
      name: `פוליקרבונט חלול (פוליגל) ${t} מ״מ`,
      short: `חלול ${t}`,
      thickness: t,
      depth: t,
      kgPerM2: { 6: 1.3, 8: 1.5, 10: 1.7, 16: 2.7 }[t],
      width: 2100,
      tints: ['clear', 'bronze', 'opal'],
    }),
  ),
  ...([3, 5] as const).map(
    (t): SheetDef => ({
      key: `pc_solid_${t}`,
      name: `פוליקרבונט מלא ${t} מ״מ`,
      short: `מלא ${t}`,
      thickness: t,
      depth: t,
      // Polycarbonate weighs 1.2 g/cm³
      kgPerM2: Math.round(1.2 * t * 10) / 10,
      tints: ['clear', 'bronze', 'opal'],
    }),
  ),
];

export const SHEET_KEYS = SHEETS.map((s) => s.key);

/** Tints: their name, and how the 3D view shows them */
export const TINTS: Record<SheetTint, { name: string; color: string; opacity: number }> = {
  clear: { name: 'שקוף', color: '#dfeef5', opacity: 0.38 },
  bronze: { name: 'ברונזה', color: '#8a6a45', opacity: 0.62 },
  opal: { name: 'לבן אופל', color: '#f2f1ec', opacity: 0.82 },
  gray: { name: 'אפור', color: '#7d8489', opacity: 0.6 },
};

export const isSheet = (key: unknown): key is SheetKey => typeof key === 'string' && (SHEET_KEYS as string[]).includes(key);
export const isTint = (key: unknown): key is SheetTint => typeof key === 'string' && key in TINTS;
export const sheetInfo = (key: string | null | undefined): SheetDef | null => SHEETS.find((s) => s.key === key) ?? null;

/** The tint a sheet is shown in: the one asked for when it comes in it, else its first */
export function sheetTint(key: SheetKey, tint: string | null | undefined): SheetTint {
  const def = sheetInfo(key);
  return def && isTint(tint) && def.tints.includes(tint) ? tint : (def?.tints[0] ?? 'clear');
}

/** "סנטף מלבני (טרפז 76/16), פוליקרבונט 0.8 מ״מ, שקוף" */
export function sheetName(key: SheetKey, tint?: string | null): string {
  const def = sheetInfo(key);
  if (!def) return 'סנטף';
  return `${def.name}, ${TINTS[sheetTint(key, tint)].name}`;
}

/**
 * How many sheets, laid side by side, cover `across` mm: each overlaps the one before it, so it adds its covered width,
 * and the last one its whole width. Null when the maker gives no width.
 */
export function sheetCount(key: SheetKey, across: number): number | null {
  const def = sheetInfo(key);
  if (!def?.width || !(across > 0)) return null;
  const cover = def.cover ?? def.width;
  return 1 + Math.max(0, Math.ceil((across - def.width - 0.5) / cover));
}

/**
 * Whether the frame under a sheet holds it: the gaps between the purlins (positions across, mm, edges included) against
 * the maker's spans. A sheet can run either way, so the caller passes the purlins of one direction at a time.
 */
export function purlinGap(key: SheetKey, positions: number[]): { gap: number; limit: number; ok: boolean } | null {
  const def = sheetInfo(key);
  if (!def?.purlin || positions.length < 2) return null;
  const at = [...new Set(positions.map((p) => Math.round(p)))].sort((a, b) => a - b);
  if (at.length < 2) return null;
  let worst = { gap: 0, limit: def.purlin.mid, over: -Infinity };
  for (let i = 1; i < at.length; i++) {
    const gap = at[i] - at[i - 1];
    const limit = i === 1 || i === at.length - 1 ? def.purlin.end : def.purlin.mid;
    if (gap - limit > worst.over) worst = { gap, limit, over: gap - limit };
  }
  return { gap: worst.gap, limit: worst.limit, ok: worst.over <= 0 };
}
