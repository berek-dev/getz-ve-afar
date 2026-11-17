/** Validation for job lines (bill of quantities). Pure, so it can be unit-tested without D1. */
import { UNITS } from '../src/core/types.ts';
import type { Unit } from '../src/core/types.ts';

export interface ItemInput {
  element_id: number | null;
  group_name: string | null;
  description: string;
  quantity: number;
  unit: Unit;
  unit_cost: number;
  length_mm: number | null;
  pieces: number | null;
}

export type ItemValidation = { ok: true; item: ItemInput } | { ok: false; error: string };

const MAX_LENGTH_MM = 24_000;
const MAX_PIECES = 1000;

function optionalPositiveInt(v: unknown, max: number): number | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > max) return 'invalid';
  return n;
}

function nonNegative(v: unknown): number | 'invalid' {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : 'invalid';
}

/**
 * Normalises a line from the client. When pieces × length are given for a metre-priced
 * line, the quantity is derived from them so the two can never disagree.
 */
export function validateItem(body: Record<string, unknown>): ItemValidation {
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) return { ok: false, error: 'description is required' };
  if (description.length > 200) return { ok: false, error: 'description too long' };

  const unit = body.unit as Unit;
  if (!UNITS.includes(unit)) return { ok: false, error: 'invalid unit' };

  const unitCost = nonNegative(body.unit_cost ?? 0);
  if (unitCost === 'invalid') return { ok: false, error: 'invalid unit_cost' };

  const length = optionalPositiveInt(body.length_mm, MAX_LENGTH_MM);
  const pieces = optionalPositiveInt(body.pieces, MAX_PIECES);
  if (length === 'invalid') return { ok: false, error: 'invalid length_mm' };
  if (pieces === 'invalid') return { ok: false, error: 'invalid pieces' };

  let quantity: number;
  let lengthMm: number | null = null;
  let pieceCount: number | null = null;
  if (unit === 'm' && length !== null && pieces !== null) {
    lengthMm = length;
    pieceCount = pieces;
    quantity = Math.round(length * pieces) / 1000;
  } else {
    const q = nonNegative(body.quantity);
    if (q === 'invalid') return { ok: false, error: 'invalid quantity' };
    quantity = q;
  }

  const elementRaw = body.element_id;
  let elementId: number | null = null;
  if (elementRaw !== null && elementRaw !== undefined && elementRaw !== '') {
    const n = Number(elementRaw);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'invalid element_id' };
    elementId = n;
  }

  const group = typeof body.group_name === 'string' ? body.group_name.trim().slice(0, 60) : '';

  return {
    ok: true,
    item: {
      element_id: elementId,
      group_name: group || null,
      description,
      quantity,
      unit,
      unit_cost: unitCost,
      length_mm: lengthMm,
      pieces: pieceCount,
    },
  };
}
