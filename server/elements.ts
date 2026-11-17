/** Validation for price-list entries and suppliers. Pure, unit-tested. */
import { UNITS } from '../src/core/types.ts';
import type { ElementCategory, Unit } from '../src/core/types.ts';

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

/** Keeps digits and a leading +; empty → null. */
export function normalizePhone(v: unknown): string | null | 'invalid' {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return 'invalid';
  const trimmed = v.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\s\-().]/g, '');
  if (!/^\+?\d{7,15}$/.test(cleaned)) return 'invalid';
  return cleaned;
}

export function validateSupplier(body: Record<string, unknown>): Result<SupplierInput> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) return { ok: false, error: 'name is required' };
  const phone = normalizePhone(body.phone);
  if (phone === 'invalid') return { ok: false, error: 'invalid phone' };
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;
  return { ok: true, value: { name, phone, notes } };
}

/** wa.me wants the number with country code and no +. Israeli 05x → 9725x. */
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits.length >= 9 ? digits : null;
}
