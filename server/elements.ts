/** Validation for price-list entries and suppliers. Pure, unit-tested. */
import { UNITS } from '../src/core/types.ts';
import type { ElementCategory, Unit } from '../src/core/types.ts';
import { normalizePhone } from '../src/core/phone.ts';

export { normalizePhone, whatsappNumber } from '../src/core/phone.ts';

export const ELEMENT_CATEGORIES: readonly ElementCategory[] = [
  'profile',
  'plate',
  'pipe',
  'fitting',
  'hardware',
  'weld',
  'labor',
  'finish',
  'equipment',
  'other',
];

export interface ElementInput {
  category: ElementCategory;
  name: string;
  unit: Unit;
  unit_cost: number;
  weight_kg_per_unit: number | null;
  stock_length_mm: number | null;
  supplier_id: number | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function optNumber(v: unknown, { min = 0, max = 1e9, integer = false } = {}): number | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return 'invalid';
  return n;
}

export function validateElement(body: Record<string, unknown>): Result<ElementInput> {
  const category = body.category as ElementCategory;
  if (!ELEMENT_CATEGORIES.includes(category)) return { ok: false, error: 'invalid category' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) return { ok: false, error: 'name is required' };
  const unit = body.unit as Unit;
  if (!UNITS.includes(unit)) return { ok: false, error: 'invalid unit' };
  const cost = optNumber(body.unit_cost ?? 0);
  if (cost === 'invalid' || cost === null) return { ok: false, error: 'invalid unit_cost' };
  const weight = optNumber(body.weight_kg_per_unit, { max: 100_000 });
  if (weight === 'invalid') return { ok: false, error: 'invalid weight' };
  const stock = optNumber(body.stock_length_mm, { min: 1, max: 24_000, integer: true });
  if (stock === 'invalid') return { ok: false, error: 'invalid stock_length_mm' };
  const supplier = optNumber(body.supplier_id, { min: 1, integer: true });
  if (supplier === 'invalid') return { ok: false, error: 'invalid supplier_id' };
  return {
    ok: true,
    value: {
      category,
      name,
      unit,
      unit_cost: cost,
      weight_kg_per_unit: weight === 0 ? null : weight,
      stock_length_mm: stock,
      supplier_id: supplier,
    },
  };
}

export interface SupplierInput {
  name: string;
  phone: string | null;
  notes: string | null;
}

export function validateSupplier(body: Record<string, unknown>): Result<SupplierInput> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) return { ok: false, error: 'name is required' };
  const phone = normalizePhone(body.phone);
  if (phone === 'invalid') return { ok: false, error: 'invalid phone' };
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;
  return { ok: true, value: { name, phone, notes } };
}
