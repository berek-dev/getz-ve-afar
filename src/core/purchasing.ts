/**
 * Material orders per supplier, derived from a job's bill of quantities.
 *
 * Profiles are ordered as whole stock bars (from the cut plan), everything else at the
 * quantity in the job. Labor and the shop's own equipment are never ordered.
 */
import { round2 } from './money.ts';
import { isCutLine, isLaborLine } from './quantities.ts';
import type { CutPlan, QuantityLine } from './quantities.ts';
import { UNIT_LABELS } from './types.ts';
import type { ElementCategory } from './types.ts';

export interface OrderItem extends QuantityLine {
  supplier_id?: number | null;
  supplier_name?: string | null;
  supplier_phone?: string | null;
}

export interface OrderLine {
  name: string;
  qty: string;
  /** e.g. pieces longer than a stock bar */
  note: string | null;
}

export interface SupplierOrder {
  /** null = no supplier set in the price list yet */
  supplierId: number | null;
  supplierName: string | null;
  supplierPhone: string | null;
  lines: OrderLine[];
  /** Estimated cost at price-list prices */
  cost: number;
}

/** Bought material even without a supplier set. Other uncategorised lines (delivery, own equipment) are skipped. */
const MATERIAL_CATEGORIES: readonly ElementCategory[] = ['profile', 'plate', 'pipe', 'fitting', 'hardware'];

const num = (n: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(n);

export function barsText(count: number, stockLengthMm: number): string {
  const m = num(stockLengthMm / 1000);
  return count === 1 ? `מוט אחד של ${m} מ׳` : `${count} מוטות של ${m} מ׳`;
}

function isOrdered(line: OrderItem): boolean {
  if (isLaborLine(line)) return false;
  if (line.category === 'equipment' && !line.supplier_id) return false;
  if (line.supplier_id) return true;
  if (line.category && MATERIAL_CATEGORIES.includes(line.category)) return true;
  // A free-text line measured as pieces × length is steel to buy
  return line.element_id == null && isCutLine(line);
}

function cutKey(line: OrderItem): string {
  return line.element_id != null ? `e${line.element_id}` : `d:${line.description.trim()}`;
}

export function buildOrders(items: OrderItem[], cutPlans: CutPlan[]): SupplierOrder[] {
  const orders = new Map<string, SupplierOrder>();
  const orderFor = (line: OrderItem): SupplierOrder => {
    const key = line.supplier_id ? `s${line.supplier_id}` : 'none';
    let order = orders.get(key);
    if (!order) {
      order = {
        supplierId: line.supplier_id ?? null,
        supplierName: line.supplier_id ? (line.supplier_name ?? null) : null,
        supplierPhone: line.supplier_id ? (line.supplier_phone ?? null) : null,
        lines: [],
        cost: 0,
      };
      orders.set(key, order);
    }
    return order;
  };

  const plans = new Map(cutPlans.map((p) => [p.key, p]));
  const doneCuts = new Set<string>();
  const merged = new Map<string, { order: SupplierOrder; line: OrderLine; qty: number; unit: OrderItem['unit'] }>();

  for (const line of items) {
    if (!isOrdered(line)) continue;
    const order = orderFor(line);

    if (isCutLine(line)) {
      const key = cutKey(line);
      const plan = plans.get(key);
      if (!plan || doneCuts.has(key)) continue;
      doneCuts.add(key);
      const parts: string[] = [];
      if (plan.bars.length > 0) parts.push(barsText(plan.bars.length, plan.stockLengthMm));
      const note =
        plan.oversize.length > 0
          ? `${plan.oversize.length === 1 ? 'ועוד חתיכה אחת ארוכה ממוט' : `ועוד ${plan.oversize.length} חתיכות ארוכות ממוט`}: ${plan.oversize
              .map((p) => `${num(p / 1000)} מ׳`)
              .join(', ')}`
          : null;
      order.lines.push({ name: plan.name, qty: parts.join('') || '—', note });
      order.cost += plan.cost;
      continue;
    }

    const name = line.element_name || line.description;
    const key = `${order.supplierId ?? 'none'}|${line.element_id ?? `d:${line.description.trim()}`}|${line.unit}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += line.quantity;
      existing.line.qty = `${num(round2(existing.qty))} ${UNIT_LABELS[line.unit]}`;
    } else {
      const entry = { order, line: { name, qty: `${num(line.quantity)} ${UNIT_LABELS[line.unit]}`, note: null }, qty: line.quantity, unit: line.unit };
      merged.set(key, entry);
      order.lines.push(entry.line);
    }
    order.cost += line.quantity * line.unit_cost;
  }

  const list = [...orders.values()].map((o) => ({ ...o, cost: round2(o.cost) }));
  // Named suppliers first (by name), "no supplier" last
  return list.sort((a, b) =>
    a.supplierId === null ? 1 : b.supplierId === null ? -1 : (a.supplierName ?? '').localeCompare(b.supplierName ?? '', 'he'),
  );
}

/** WhatsApp text for a supplier. Never includes client details. */
export function orderMessage(order: SupplierOrder, opts: { businessName: string; jobTitle: string }): string {
  const hello = order.supplierName ? `שלום ${order.supplierName},` : 'שלום,';
  const lines = order.lines.map((l) => `• ${l.name}: ${l.qty}${l.note ? ` (${l.note})` : ''}`);
  return [`${hello} הזמנה מ${opts.businessName} (עבור ${opts.jobTitle}):`, ...lines, '', 'אפשר לאשר מחיר וזמן אספקה? תודה'].join('\n');
}
