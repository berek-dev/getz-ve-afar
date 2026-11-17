/**
 * Bill of quantities: turns a job's lines into a cut list, weight and price.
 *
 * Profiles cut from stock bars are priced by the bars that must actually be bought,
 * not by the net metres that end up in the job – the off-cuts are a real cost.
 */
import { priceBreakdown, round2 } from './money.ts';
import type { PriceBreakdown } from './money.ts';
import type { JobItem, Settings } from './types.ts';

/** Minimal line shape the engine needs (JobItem satisfies it). */
export type QuantityLine = Pick<
  JobItem,
  'element_id' | 'description' | 'quantity' | 'unit' | 'unit_cost' | 'length_mm' | 'pieces'
> &
  Partial<Pick<JobItem, 'category' | 'weight_kg_per_unit' | 'stock_length_mm'>>;

export type PricingSettings = Pick<Settings, 'overhead_pct' | 'margin_pct' | 'vat_pct' | 'bar_length_mm' | 'kerf_mm'>;

export interface CutBar {
  /** Piece lengths in mm, in cutting order */
  pieces: number[];
  /** mm used including the kerf between pieces */
  used: number;
  /** mm left over at the end of the bar */
  offcut: number;
}

export interface CutPlan {
  /** Groups lines of the same profile (library element, else the line's description) */
  key: string;
  name: string;
  stockLengthMm: number;
  kerfMm: number;
  bars: CutBar[];
  /** Pieces longer than a stock bar – need a longer bar or a joint; priced by net length */
  oversize: number[];
  netLengthMm: number;
  boughtLengthMm: number;
  /** Share of the bought steel that becomes off-cut, 0..1 */
  waste: number;
  pricePerMeter: number;
  /** Bars bought × length × price, plus oversize pieces at net length */
  cost: number;
}

export interface JobTotals {
  cutPlans: CutPlan[];
  /** Materials at the listed quantities (net metres for profiles) */
  materialsNet: number;
  /** Materials with cut profiles priced by bars bought – this is what the quote uses */
  materials: number;
  labor: number;
  weightKg: number;
  price: PriceBreakdown;
}

const MAX_PIECES_PER_LINE = 1000;

export function lineTotal(line: QuantityLine): number {
  return round2(line.quantity * line.unit_cost);
}

/** Labor = the work itself: hours, and per-joint welding prices. Everything else is material/equipment. */
export function isLaborLine(line: QuantityLine): boolean {
  return line.unit === 'hour' || line.category === 'labor' || line.category === 'weld';
}

/** A line measured in metres with pieces × length goes through the cut list. */
export function isCutLine(line: QuantityLine): boolean {
  return (
    line.unit === 'm' &&
    typeof line.length_mm === 'number' &&
    line.length_mm > 0 &&
    typeof line.pieces === 'number' &&
    line.pieces > 0
  );
}

/**
 * First-fit decreasing: longest pieces first, each into the first bar it still fits.
 * The kerf (blade width) is lost between consecutive pieces on the same bar.
 */
export function planCuts(pieces: number[], stockLengthMm: number, kerfMm: number): { bars: CutBar[]; oversize: number[] } {
  const bars: CutBar[] = [];
  const oversize: number[] = [];
  for (const piece of [...pieces].sort((a, b) => b - a)) {
    if (piece > stockLengthMm) {
      oversize.push(piece);
      continue;
    }
    const bar = bars.find((b) => b.used + kerfMm + piece <= stockLengthMm);
    if (bar) {
      bar.pieces.push(piece);
      bar.used += kerfMm + piece;
      bar.offcut = stockLengthMm - bar.used;
    } else {
      bars.push({ pieces: [piece], used: piece, offcut: stockLengthMm - piece });
    }
  }
  return { bars, oversize };
}

export function computeJob(lines: QuantityLine[], settings: PricingSettings): JobTotals {
  let labor = 0;
  let materialsNet = 0;
  let otherMaterials = 0;
  let weightKg = 0;

  const groups = new Map<string, { name: string; pieces: number[]; stock: number; price: number }>();

  for (const line of lines) {
    const total = line.quantity * line.unit_cost;
    if (line.weight_kg_per_unit) weightKg += line.quantity * line.weight_kg_per_unit;

    if (isLaborLine(line)) {
      labor += total;
      continue;
    }
    materialsNet += total;

    if (!isCutLine(line)) {
      otherMaterials += total;
      continue;
    }

    const key = line.element_id != null ? `e${line.element_id}` : `d:${line.description.trim()}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        name: line.description,
        pieces: [],
        stock: line.stock_length_mm || settings.bar_length_mm,
        price: line.unit_cost,
      };
      groups.set(key, group);
    }
    const count = Math.min(line.pieces as number, MAX_PIECES_PER_LINE);
    for (let i = 0; i < count; i++) group.pieces.push(line.length_mm as number);
  }

  const cutPlans: CutPlan[] = [];
  for (const [key, g] of groups) {
    const { bars, oversize } = planCuts(g.pieces, g.stock, settings.kerf_mm);
    const netLengthMm = g.pieces.reduce((s, p) => s + p, 0);
    const oversizeMm = oversize.reduce((s, p) => s + p, 0);
    const boughtLengthMm = bars.length * g.stock + oversizeMm;
    cutPlans.push({
      key,
      name: g.name,
      stockLengthMm: g.stock,
      kerfMm: settings.kerf_mm,
      bars,
      oversize,
      netLengthMm,
      boughtLengthMm,
      waste: boughtLengthMm > 0 ? (boughtLengthMm - netLengthMm) / boughtLengthMm : 0,
      pricePerMeter: g.price,
      cost: round2((boughtLengthMm / 1000) * g.price),
    });
  }

  const materials = otherMaterials + cutPlans.reduce((s, p) => s + p.cost, 0);

  return {
    cutPlans,
    materialsNet: round2(materialsNet),
    materials: round2(materials),
    labor: round2(labor),
    weightKg: round2(weightKg),
    price: priceBreakdown({
      materials,
      labor,
      overheadPct: settings.overhead_pct,
      marginPct: settings.margin_pct,
      vatPct: settings.vat_pct,
    }),
  };
}
