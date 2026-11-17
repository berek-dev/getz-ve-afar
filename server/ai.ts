/**
 * Turns a dictated job description into draft bill-of-quantities lines (Gemini, free tier).
 * Only the job text and the price list are sent – never client names or phone numbers.
 * Drafts are always shown to the user for review before anything is saved.
 */
import { UNITS } from '../src/core/types.ts';
import type { ElementCategory, Unit } from '../src/core/types.ts';
import { validateItem } from './items.ts';
import type { ItemInput } from './items.ts';

export interface PriceListEntry {
  id: number;
  name: string;
  unit: Unit;
  category: ElementCategory;
  unit_cost: number;
  stock_length_mm: number | null;
}

export const SYSTEM_PROMPT = `You draft a bill of quantities for a small metalwork and welding shop in Israel.
You get a job description in Hebrew (often dictated, informal, with typos) and the shop's price list.
Return draft lines that the owner will review. Rules:
- Prefer a price-list element when one matches: set element_id to its id and use its unit.
  Otherwise set element_id to null and write a short Hebrew description.
- Steel profiles, tubes and pipes that are cut from stock bars: unit "m", pieces = number of identical pieces,
  length_mm = length of ONE piece in millimetres, quantity = total metres. Separate lines for different lengths.
- Hardware and accessories: unit "unit". Painting/galvanising: unit "m2". Field pipe welds: unit "joint".
- Labor: unit "hour", realistic hours, separate lines for shop fabrication and on-site installation.
- Convert centimetres and metres to millimetres for length_mm. Never invent measurements that are not implied;
  if a measurement is missing, make a reasonable assumption and say so in notes.
- group_name: a short Hebrew group such as "עמודים", "מסגרת", "מילוי", "פרזול", "גמר", "התקנה", "עבודה".
- Descriptions and notes in Hebrew. Never include people's names, phone numbers or addresses. No prices.
- At most 30 lines.`;

export function userPrompt(job: { title: string; kind: string; description: string | null }, text: string, list: PriceListEntry[]): string {
  const catalog = list
    .map((e) => `${e.id} | ${e.name} | ${e.unit} | ${e.category}${e.stock_length_mm ? ` | bar ${e.stock_length_mm}mm` : ''}`)
    .join('\n');
  return [
    `Job type: ${job.kind}`,
    `Job title: ${job.title}`,
    job.description ? `Job notes: ${job.description}` : '',
    `What the owner described:\n${text}`,
    `Price list (id | name | unit | category):\n${catalog || '(empty)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          element_id: { type: 'INTEGER', nullable: true },
          group_name: { type: 'STRING' },
          description: { type: 'STRING' },
          unit: { type: 'STRING', enum: [...UNITS] },
          quantity: { type: 'NUMBER' },
          pieces: { type: 'INTEGER', nullable: true },
          length_mm: { type: 'INTEGER', nullable: true },
        },
        required: ['element_id', 'group_name', 'description', 'unit', 'quantity'],
      },
    },
    notes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['lines', 'notes'],
} as const;

/** Model output → validated item drafts priced from the price list. Anything malformed is dropped. */
export function sanitizeDraft(
  raw: unknown,
  list: PriceListEntry[],
  hourlyRate: number,
): { lines: ItemInput[]; notes: string[] } {
  const obj = (raw ?? {}) as { lines?: unknown; notes?: unknown };
  const byId = new Map(list.map((e) => [e.id, e]));
  const lines: ItemInput[] = [];
  for (const r of Array.isArray(obj.lines) ? obj.lines.slice(0, 30) : []) {
    const l = (r ?? {}) as Record<string, unknown>;
    const unit = UNITS.includes(l.unit as Unit) ? (l.unit as Unit) : null;
    if (!unit) continue;
    let el = typeof l.element_id === 'number' ? byId.get(l.element_id) : undefined;
    if (el && el.unit !== unit) el = undefined;
    const description = (typeof l.description === 'string' ? l.description.trim() : '') || el?.name || '';
    const pieces = unit === 'm' && Number.isInteger(l.pieces) && (l.pieces as number) > 0 ? l.pieces : null;
    const length = unit === 'm' && Number.isInteger(l.length_mm) && (l.length_mm as number) > 0 ? l.length_mm : null;
    const v = validateItem({
      element_id: el?.id ?? null,
      group_name: typeof l.group_name === 'string' ? l.group_name.trim().slice(0, 40) || null : null,
      description: description.slice(0, 120),
      quantity: typeof l.quantity === 'number' && l.quantity > 0 ? l.quantity : pieces && length ? 0 : 1,
      unit,
      unit_cost: el ? el.unit_cost : unit === 'hour' ? hourlyRate : 0,
      length_mm: pieces && length ? length : null,
      pieces: pieces && length ? pieces : null,
    });
    if (v.ok) lines.push(v.item);
  }
  const notes = Array.isArray(obj.notes)
    ? obj.notes.filter((n): n is string => typeof n === 'string' && n.trim() !== '').slice(0, 8).map((n) => n.trim().slice(0, 200))
    : [];
  return { lines, notes };
}
