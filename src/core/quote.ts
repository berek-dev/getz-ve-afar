/**
 * What the client sees in a quote: the scope of work and the price – never the
 * internal costs, margins or cut list. Frozen as a snapshot when the quote is sent,
 * so later edits to the job don't change a quote the client already has.
 */
import { computeJob, isCutLine, isLaborLine } from './quantities.ts';
import type { PricingSettings, QuantityLine } from './quantities.ts';
import { UNIT_LABELS } from './types.ts';
import type { JobKind } from './types.ts';

export interface QuoteSnapshot {
  v: 1;
  business: { name: string; phone: string | null };
  job: {
    title: string;
    kind: JobKind;
    client_name: string | null;
    site_address: string | null;
    description: string | null;
  };
  scope: { group: string; lines: { text: string; detail: string | null }[] }[];
  totals: { beforeVat: number; vat: number; total: number; vatPct: number };
  terms: string | null;
  validDays: number;
  /** 3D layout of the work (src/core/scene.ts), when the quote was sent with it */
  model?: unknown;
}

export interface QuoteJobInput {
  title: string;
  kind: JobKind;
  client_name: string | null;
  site_address: string | null;
  description: string | null;
}

export interface QuoteLine extends QuantityLine {
  group_name: string | null;
}

const num = (n: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(n);

function lineDetail(line: QuoteLine): string | null {
  if (isLaborLine(line)) return null; // the client sees the work, not the hours
  if (isCutLine(line)) return `${line.pieces} יח׳ באורך ${num(line.length_mm ?? 0)} מ״מ`;
  return `${num(line.quantity)} ${UNIT_LABELS[line.unit]}`;
}

export function buildQuoteSnapshot(
  job: QuoteJobInput,
  lines: QuoteLine[],
  settings: PricingSettings & { business_name: string; business_phone?: string | null; quote_terms?: string | null; quote_valid_days?: number | null },
): QuoteSnapshot {
  const totals = computeJob(lines, settings);
  const groups = new Map<string, { text: string; detail: string | null }[]>();
  for (const line of lines) {
    const key = line.group_name ?? 'כללי';
    groups.set(key, [...(groups.get(key) ?? []), { text: line.description, detail: lineDetail(line) }]);
  }
  return {
    v: 1,
    business: { name: settings.business_name, phone: settings.business_phone ?? null },
    job: {
      title: job.title,
      kind: job.kind,
      client_name: job.client_name,
      site_address: job.site_address,
      description: job.description,
    },
    scope: [...groups.entries()].map(([group, groupLines]) => ({ group, lines: groupLines })),
    totals: {
      beforeVat: totals.price.beforeVat,
      vat: totals.price.vat,
      total: totals.price.total,
      vatPct: settings.vat_pct,
    },
    terms: settings.quote_terms?.trim() || null,
    validDays: settings.quote_valid_days ?? 14,
  };
}

/** Status the client sees, taking expiry into account. */
export function effectiveQuoteStatus(status: string, validUntil: string | null, today: string): string {
  if (status === 'sent' && validUntil && validUntil < today) return 'expired';
  return status;
}
