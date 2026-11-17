/**
 * Pricing helpers. Pure functions, no I/O — shared by the app and the server.
 * All amounts are in ILS; rounding happens only on the final figures.
 */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface PriceInput {
  /** Materials cost before markups */
  materials: number;
  /** Labor cost before markups (hours × rate, joints × price, etc.) */
  labor: number;
  /** Overhead as % of (materials + labor) */
  overheadPct: number;
  /** Profit margin as % on top of cost incl. overhead */
  marginPct: number;
  /** VAT % (Israel default 18, editable in settings) */
  vatPct: number;
}

export interface PriceBreakdown {
  materials: number;
  labor: number;
  cost: number;
  overhead: number;
  margin: number;
  beforeVat: number;
  vat: number;
  total: number;
}

export function priceBreakdown(input: PriceInput): PriceBreakdown {
  for (const [k, v] of Object.entries(input)) {
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`${k} must be a non-negative number`);
  }
  const cost = input.materials + input.labor;
  const overhead = (cost * input.overheadPct) / 100;
  const margin = ((cost + overhead) * input.marginPct) / 100;
  const beforeVat = cost + overhead + margin;
  const vat = (beforeVat * input.vatPct) / 100;
  return {
    materials: round2(input.materials),
    labor: round2(input.labor),
    cost: round2(cost),
    overhead: round2(overhead),
    margin: round2(margin),
    beforeVat: round2(beforeVat),
    vat: round2(vat),
    total: round2(beforeVat + vat),
  };
}

const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });

export function formatIls(n: number): string {
  return ils.format(n);
}
