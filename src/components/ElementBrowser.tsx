import { useMemo, useState } from 'react';
import { ELEMENT_CATEGORY_LABELS, UNIT_PER } from '../core/types.ts';
import type { Element, ElementCategory, Material } from '../core/types.ts';
import { MATERIALS, familyDef, familyOrder } from '../core/catalog.ts';
import { formatIls } from '../core/money.ts';
import { fmtNum } from '../lib/format.ts';
import { Icon } from './Icon.tsx';

const CATEGORY_ORDER = Object.keys(ELEMENT_CATEGORY_LABELS) as ElementCategory[];
const MATERIAL_ORDER = MATERIALS.map((m) => m.key as string);
const collator = new Intl.Collator('he', { numeric: true });
export const GENERAL_FAMILY = 'כללי';

export interface FamilyRef {
  category: ElementCategory;
  family: string;
  material: string | null;
}

/** "60x40", "60*40", "60×40" all find "60/40" */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/(\d)\s*[x×*X]\s*(?=\d)/g, '$1/');
}

function matches(el: Element, q: string): boolean {
  return [el.name, el.family, el.size, el.supplier_name].some((v) => v && v.includes(q));
}

function bySize(a: Element, b: Element): number {
  return collator.compare(a.size ?? a.name, b.size ?? b.name);
}

function priceText(el: Element): string {
  return el.unit_cost > 0 ? `${formatIls(el.unit_cost)} ${UNIT_PER[el.unit]}` : 'חסר מחיר';
}

/**
 * The price list as a menu: category → family → material → size.
 * Used by the price list page (tap = edit) and by the line editor (tap = pick).
 */
export function ElementBrowser({
  elements,
  materials = [],
  query,
  selectedId = null,
  onPick,
  onAdd,
}: {
  elements: Element[];
  materials?: Material[];
  query: string;
  selectedId?: number | null;
  onPick: (el: Element) => void;
  /** Shown as "add size / item" at the end of each family (price list page only) */
  onAdd?: (ref: FamilyRef) => void;
}) {
  const categories = useMemo(() => CATEGORY_ORDER.filter((c) => elements.some((e) => e.category === c)), [elements]);
  const selected = elements.find((e) => e.id === selectedId);
  const [category, setCategory] = useState<ElementCategory | null>(selected?.category ?? null);
  const active = category && categories.includes(category) ? category : (categories[0] ?? null);

  const families = useMemo(() => {
    const map = new Map<string, Element[]>();
    for (const el of elements) {
      if (el.category !== active) continue;
      const f = el.family ?? GENERAL_FAMILY;
      map.set(f, [...(map.get(f) ?? []), el]);
    }
    return [...map.entries()].sort(([a], [b]) => familyOrder(a) - familyOrder(b) || collator.compare(a, b));
  }, [elements, active]);

  const q = normalizeQuery(query);
  if (q) {
    const found = elements
      .filter((el) => matches(el, q))
      .sort((a, b) => familyOrder(a.family) - familyOrder(b.family) || bySize(a, b))
      .slice(0, 80);
    if (found.length === 0) return <p className="mt-6 text-center text-steel-300">לא נמצא. נסה מילה אחרת, למשל ״60/40״ או ״ציר״.</p>;
    return (
      <ul className="plate mt-3 divide-y divide-steel-700 rounded-[10px]">
        {found.map((el) => (
          <ItemRow key={el.id} el={el} selected={el.id === selectedId} onPick={onPick} showFamily />
        ))}
      </ul>
    );
  }

  return (
    <div className="mt-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="קטגוריות">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={c === active}
            onClick={() => setCategory(c)}
            className={`min-h-11 shrink-0 rounded-full border px-4 font-semibold ${
              c === active ? 'border-hivis bg-hivis text-steel-950' : 'border-steel-700 text-steel-300'
            }`}
          >
            {ELEMENT_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {families.map(([family, items]) => (
          <FamilyBlock
            key={`${active}:${family}`}
            family={family}
            items={items}
            materials={materials}
            selectedId={selectedId}
            defaultOpen={families.length === 1 || items.some((i) => i.id === selectedId)}
            onPick={onPick}
            onAdd={onAdd && active ? (material) => onAdd({ category: active, family, material }) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function FamilyBlock({
  family,
  items,
  materials,
  selectedId,
  defaultOpen,
  onPick,
  onAdd,
}: {
  family: string;
  items: Element[];
  materials: Material[];
  selectedId: number | null;
  defaultOpen: boolean;
  onPick: (el: Element) => void;
  onAdd?: (material: string | null) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const mats = MATERIAL_ORDER.filter((m) => items.some((i) => i.material === m));
  const selected = items.find((i) => i.id === selectedId);
  const [mat, setMat] = useState<string | null>(selected?.material ?? mats[0] ?? null);
  const shown = (mats.length > 0 ? items.filter((i) => i.material === mat || (!i.material && mat === mats[0])) : items).sort(bySize);
  const grid = shown.length > 0 && shown.every((i) => i.size);
  const wide = shown.some((i) => (i.size ?? '').length > 9);
  const perKg = materials.find((m) => m.key === mat);
  const missing = items.filter((i) => i.unit_cost <= 0).length;
  const def = familyDef(family);

  return (
    <section className="plate rounded-[10px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{family}</span>
          <span className="block text-sm text-steel-300">
            {items.length} פריטים
            {mats.length > 0 && `, ${mats.map((m) => MATERIALS.find((x) => x.key === m)?.short).join(', ')}`}
            {missing > 0 && <span className="text-hivis">, {missing} בלי מחיר</span>}
          </span>
        </span>
        <Icon name={open ? 'close' : 'plus'} size={18} className="shrink-0 text-steel-500" />
      </button>

      {open && (
        <div className="border-t border-steel-700 p-3">
          {mats.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="חומר">
              {mats.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={m === mat}
                  onClick={() => setMat(m)}
                  className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${
                    m === mat ? 'border-soapstone bg-soapstone text-steel-950' : 'border-steel-700 text-steel-300'
                  }`}
                >
                  {MATERIALS.find((x) => x.key === m)?.short}
                </button>
              ))}
            </div>
          )}
          {perKg && shown.some((i) => i.price_by_kg) && (
            <p className="mb-2 text-sm text-steel-300">
              {perKg.price_per_kg > 0
                ? `לפי ${formatIls(perKg.price_per_kg)} לק״ג (${perKg.name}). המחיר לק״ג מתעדכן למעלה.`
                : `עוד לא נקבע מחיר לק״ג ל${perKg.name}. קבע אותו למעלה ומחירי כל המידות יתעדכנו.`}
            </p>
          )}

          {grid ? (
            <ul className={`grid gap-1.5 ${wide ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {shown.map((el) => (
                <li key={el.id}>
                  <button
                    type="button"
                    onClick={() => onPick(el)}
                    aria-pressed={el.id === selectedId}
                    aria-label={`${el.name}, ${priceText(el)}`}
                    className={`flex min-h-14 w-full flex-col items-center justify-center rounded-lg border px-1 py-1.5 ${
                      el.id === selectedId ? 'border-hivis bg-steel-950' : 'border-steel-700 bg-steel-900 active:bg-steel-700'
                    }`}
                  >
                    <span className="tnum font-semibold leading-tight">{el.size}</span>
                    <span className={`tnum text-xs ${el.unit_cost > 0 ? 'text-steel-300' : 'text-hivis'}`}>
                      {el.unit_cost > 0 ? formatIls(el.unit_cost) : 'חסר מחיר'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="-mx-3 divide-y divide-steel-700">
              {shown.map((el) => (
                <ItemRow key={el.id} el={el} selected={el.id === selectedId} onPick={onPick} />
              ))}
            </ul>
          )}

          {grid && shown[0]?.weight_kg_per_unit ? (
            <p className="mt-2 text-xs text-steel-500">
              מחיר {UNIT_PER[shown[0].unit]}. משקל לדוגמה: {shown[0].size}, {fmtNum(shown[0].weight_kg_per_unit)} ק״ג {UNIT_PER[shown[0].unit]}.
            </p>
          ) : null}

          {onAdd && (
            <button
              type="button"
              onClick={() => onAdd(mat)}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-steel-500 font-semibold text-steel-300"
            >
              <Icon name="plus" size={18} />
              {def?.shape ? 'הוסף מידה' : 'הוסף פריט'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ItemRow({
  el,
  selected,
  onPick,
  showFamily = false,
}: {
  el: Element;
  selected: boolean;
  onPick: (el: Element) => void;
  showFamily?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(el)}
        aria-pressed={selected}
        className={`flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-start ${selected ? 'bg-steel-950' : 'active:bg-steel-700'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug">{el.name}</span>
          <span className="block text-sm text-steel-300">
            {[showFamily && el.family, el.supplier_name].filter(Boolean).join(', ') || ELEMENT_CATEGORY_LABELS[el.category]}
          </span>
        </span>
        <span className={`tnum shrink-0 text-end text-sm font-semibold ${el.unit_cost > 0 ? '' : 'text-hivis'}`}>{priceText(el)}</span>
        {selected && <Icon name="check" size={18} className="shrink-0 text-hivis" />}
      </button>
    </li>
  );
}
