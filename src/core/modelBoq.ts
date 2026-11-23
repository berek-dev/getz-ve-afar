/**
 * The 3D model and the bill of quantities: check that they agree, and turn a model into BOQ lines
 * (so drawing the job also prices it).
 */
import { materialInfo } from './catalog.ts';
import { isCutLine } from './quantities.ts';
import type { QuantityLine } from './quantities.ts';
import { PART_LABELS } from './scene.ts';
import type { CutList, PartKind, ResolvedScene } from './scene.ts';
import { MODEL_GROUP } from './types.ts';
import type { Unit } from './types.ts';

export interface BoqCheckRow {
  name: string;
  modelPieces: number;
  modelMm: number;
  boqPieces: number;
  boqMm: number;
  status: 'match' | 'differs' | 'model_only' | 'boq_only';
}

/** Profile by profile: metres and pieces in the model against the BOQ's cut lines (±3% counts as a match). */
export function checkModelAgainstBoq(cut: CutList, items: QuantityLine[]): BoqCheckRow[] {
  const rows = new Map<string, BoqCheckRow>();
  const row = (name: string): BoqCheckRow => {
    let r = rows.get(name);
    if (!r) {
      r = { name, modelPieces: 0, modelMm: 0, boqPieces: 0, boqMm: 0, status: 'match' };
      rows.set(name, r);
    }
    return r;
  };
  for (const s of cut.sections) {
    const r = row(s.name);
    r.modelPieces += s.pieces;
    r.modelMm += s.totalMm;
  }
  for (const l of items) {
    if (!isCutLine(l)) continue;
    const r = row(l.element_name || l.description.trim());
    r.boqPieces += l.pieces ?? 0;
    r.boqMm += (l.pieces ?? 0) * (l.length_mm ?? 0);
  }
  for (const r of rows.values()) {
    if (r.modelMm === 0) r.status = 'boq_only';
    else if (r.boqMm === 0) r.status = 'model_only';
    else r.status = Math.abs(r.modelMm - r.boqMm) / Math.max(r.modelMm, r.boqMm) <= 0.03 ? 'match' : 'differs';
  }
  const order = { differs: 0, model_only: 1, boq_only: 2, match: 3 };
  return [...rows.values()].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'he', { numeric: true }));
}

export interface PriceListItem {
  id: number;
  name: string;
  unit: Unit;
  unit_cost: number;
  catalog_key: string | null;
}

export interface ModelLine {
  element_id: number | null;
  group_name: string | null;
  description: string;
  quantity: number;
  unit: Unit;
  unit_cost: number;
  length_mm: number | null;
  pieces: number | null;
}

/** Hardware kinds → the catalog item that prices them */
const PART_CATALOG: Partial<Record<PartKind, string>> = {
  hinge: 'item:hinge-heavy',
  guide_roller: 'item:guide-top',
  lock: 'item:lock-gate',
  handle: 'item:handle-pull',
  drop_bolt: 'item:bolt-floor',
  stopper: 'item:stopper',
  motor: 'item:motor',
  cap: 'item:cap-steel',
};

export { MODEL_GROUP };

/** BOQ lines for everything in the model: profiles as pieces × length, plates by area, hardware by count. */
export function linesFromModel(scene: ResolvedScene, cut: CutList, priceList: PriceListItem[]): ModelLine[] {
  const byName = new Map(priceList.map((e) => [e.name, e]));
  const byKey = new Map(priceList.filter((e) => e.catalog_key).map((e) => [e.catalog_key as string, e]));
  const labelOf = new Map(scene.members.map((m) => [m.id, m.label]));
  const lines: ModelLine[] = [];

  for (const p of cut.pieces) {
    const el = byName.get(p.name);
    const priced = el && el.unit === 'm' ? el : undefined;
    const label = labelOf.get(p.ids[0]);
    lines.push({
      element_id: priced?.id ?? null,
      group_name: MODEL_GROUP,
      description: `${label ?? p.name}${p.bent ? ' (מכופף)' : ''} (${p.mark})`,
      quantity: Math.round(p.count * p.length) / 1000,
      unit: 'm',
      unit_cost: priced?.unit_cost ?? 0,
      length_mm: Math.round(p.length),
      pieces: p.count,
    });
  }
  for (const p of cut.plates) {
    // Catalog plates are named "פח חלק 2 מ״מ"; match on the key (plate:<material>:<thickness>). Roofing sheets are
    // priced per m² whatever their tint (sheet:<key>).
    const plate = p.sheet ? undefined : scene.plates.find((s) => !s.sheet && `פח ${s.thickness} מ״מ${materialInfo(s.material)?.suffix ?? ''}` === p.name);
    const el = (p.sheet && byKey.get(`sheet:${p.sheet}`)) || (plate && byKey.get(`plate:${plate.material}:${plate.thickness}`)) || byName.get(p.name);
    const priced = el && el.unit === 'm2' ? el : undefined;
    lines.push({
      element_id: priced?.id ?? null,
      group_name: MODEL_GROUP,
      description: `${p.name} ${p.w}/${p.h}`,
      quantity: p.areaM2,
      unit: 'm2',
      unit_cost: priced?.unit_cost ?? 0,
      length_mm: null,
      pieces: null,
    });
  }
  const wheel = scene.parts.find((p) => p.kind === 'wheel' && p.size?.[0]);
  const wheelKey = `item:wheel-v-${[80, 100, 120].reduce((a, b) => (Math.abs(b - (wheel?.size?.[0] ?? 100)) < Math.abs(a - (wheel?.size?.[0] ?? 100)) ? b : a))}`;
  for (const p of cut.parts) {
    const key = p.kind === 'wheel' ? wheelKey : PART_CATALOG[p.kind];
    const el = key ? byKey.get(key) : undefined;
    const priced = el && el.unit === 'unit' ? el : undefined;
    lines.push({
      element_id: priced?.id ?? null,
      group_name: MODEL_GROUP,
      description: p.label === PART_LABELS[p.kind] && priced ? priced.name : p.label,
      quantity: p.count,
      unit: 'unit',
      unit_cost: priced?.unit_cost ?? 0,
      length_mm: null,
      pieces: null,
    });
  }
  return lines;
}

interface Priced {
  description: string;
  unit: string;
  unit_cost: number;
  length_mm: number | null;
}

/**
 * Prices typed by hand on the model's lines, kept when the lines are made again (approving a changed model) and the
 * price list has no price for them: the same profile, plate or part, by its description without the cut mark. A
 * line named by a label ("קורה") keeps its price only at the same length, since the label alone doesn't say the profile.
 */
export function keepTypedPrices<T extends Priced>(lines: T[], before: Priced[], sectionNames: Set<string>): T[] {
  const base = (d: string) => d.replace(/ \([A-Z]{1,3}\)$/, '');
  return lines.map((l) => {
    if (l.unit_cost > 0) return l;
    const b = base(l.description);
    const plain = sectionNames.has(b.replace(/ \(מכופף\)$/, ''));
    const old = before.find((o) => o.unit === l.unit && o.unit_cost > 0 && base(o.description) === b && (plain || l.unit !== 'm' || o.length_mm === l.length_mm));
    return old ? { ...l, unit_cost: old.unit_cost } : l;
  });
}
