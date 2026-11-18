/**
 * Steel weights from section dimensions (mm). Density 7.85 kg/dm³:
 * a cross-section of 1 mm² weighs 0.00785 kg per metre.
 */
const KG_PER_MM2_PER_M = 0.00785;

export type SteelShape = 'rect_tube' | 'round_tube' | 'angle' | 'flat' | 'round_bar' | 'square_bar' | 'plate';

export interface ShapeSpec {
  label: string;
  /** Dimension names, in the order people say them ("60/40/2") */
  dims: string[];
  /** Weight per unit: kg per metre, or kg per m² for plate */
  unit: 'm' | 'm2';
  name: (d: number[]) => string;
  kg: (d: number[]) => number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (d: number[]) => d.map((x) => String(x)).join('/');

export const SHAPES: Record<SteelShape, ShapeSpec> = {
  rect_tube: {
    label: 'פרופיל מלבני / מרובע',
    dims: ['רוחב', 'גובה', 'עובי דופן'],
    unit: 'm',
    name: (d) => `פרופיל ${fmt(d)}`,
    kg: ([b = 0, h = 0, t = 0]) => r3((2 * t * (b + h) - 4 * t * t) * KG_PER_MM2_PER_M),
  },
  round_tube: {
    label: 'צינור עגול',
    dims: ['קוטר חיצוני', 'עובי דופן'],
    unit: 'm',
    name: ([od = 0, t = 0]) => `צינור ${od}/${t}`,
    kg: ([od = 0, t = 0]) => r3(Math.PI * (od - t) * t * KG_PER_MM2_PER_M),
  },
  angle: {
    label: 'זווית',
    dims: ['צלע א', 'צלע ב', 'עובי'],
    unit: 'm',
    name: (d) => `זווית ${fmt(d)}`,
    kg: ([a = 0, b = 0, t = 0]) => r3((a + b - t) * t * KG_PER_MM2_PER_M),
  },
  flat: {
    label: 'פלח',
    dims: ['רוחב', 'עובי'],
    unit: 'm',
    name: (d) => `פלח ${fmt(d)}`,
    kg: ([w = 0, t = 0]) => r3(w * t * KG_PER_MM2_PER_M),
  },
  square_bar: {
    label: 'מוט מרובע',
    dims: ['צלע'],
    unit: 'm',
    name: ([a = 0]) => `מוט מרובע ${a}`,
    kg: ([a = 0]) => r3(a * a * KG_PER_MM2_PER_M),
  },
  round_bar: {
    label: 'מוט עגול',
    dims: ['קוטר'],
    unit: 'm',
    name: ([d = 0]) => `מוט עגול ${d}`,
    kg: ([d = 0]) => r3(((Math.PI * d * d) / 4) * KG_PER_MM2_PER_M),
  },
  plate: {
    label: 'פח',
    dims: ['עובי'],
    unit: 'm2',
    name: ([t = 0]) => `פח ${t} מ״מ`,
    // 1 m² × t mm = t dm³
    kg: ([t = 0]) => r3(t * 7.85),
  },
};

/** Steel density the shape formulas assume (kg/dm³). */
export const STEEL_DENSITY = 7.85;

/** Weight per metre (or m²) for another metal: scale the steel formula by density. */
export function kgFor(shape: SteelShape, dims: number[], density: number = STEEL_DENSITY): number {
  return r3((SHAPES[shape].kg(dims) * density) / STEEL_DENSITY);
}
