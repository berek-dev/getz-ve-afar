import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { ElementDraft } from '../lib/api.ts';
import { ELEMENT_CATEGORY_LABELS, UNITS, UNIT_PER } from '../core/types.ts';
import type { Element, ElementCategory, Supplier, Unit } from '../core/types.ts';
import { formatIls } from '../core/money.ts';
import { SHAPES } from '../core/steel.ts';
import type { SteelShape } from '../core/steel.ts';
import { fmtNum } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { toast } from '../components/Toast.tsx';

const CATEGORY_ORDER = Object.keys(ELEMENT_CATEGORY_LABELS) as ElementCategory[];

const UNIT_NAMES: Record<Unit, string> = {
  m: 'מטר',
  kg: 'ק״ג',
  unit: 'יחידה',
  hour: 'שעת עבודה',
  m2: 'מ״ר',
  joint: 'תפר ריתוך',
  day: 'יום',
};

/** Sensible unit when a category is picked. */
const DEFAULT_UNIT: Record<ElementCategory, Unit> = {
  profile: 'm',
  plate: 'm2',
  pipe: 'm',
  fitting: 'unit',
  hardware: 'unit',
  weld: 'joint',
  labor: 'hour',
  finish: 'm2',
  equipment: 'day',
  other: 'unit',
};

export function PriceListPage() {
  const [elements, setElements] = useState<Element[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Element | 'new' | null>(null);

  useEffect(() => {
    Promise.all([api.elements(), api.suppliers()])
      .then(([e, s]) => {
        setElements(e);
        setSuppliers(s);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim();
    const list = (elements ?? []).filter((e) => !q || e.name.includes(q) || (e.supplier_name ?? '').includes(q));
    return CATEGORY_ORDER.map((cat) => [cat, list.filter((e) => e.category === cat)] as const).filter(
      ([, items]) => items.length > 0,
    );
  }, [elements, query]);

  const saved = (el: Element, isNew: boolean) => {
    setElements((prev) => (isNew ? [...(prev ?? []), el] : (prev ?? []).map((e) => (e.id === el.id ? el : e))));
    if (el.supplier_id && !suppliers.some((s) => s.id === el.supplier_id)) {
      void api.suppliers().then(setSuppliers);
    }
    setEditing(null);
    toast(isNew ? 'נוסף למחירון' : 'המחירון עודכן');
  };

  const removed = (id: number) => {
    setElements((prev) => (prev ?? []).filter((e) => e.id !== id));
    setEditing(null);
    toast('הוסר מהמחירון');
  };

  return (
    <section>
      <h2 className="font-display text-[2.6rem] leading-none">מחירון</h2>
      <p className="mt-2 max-w-md text-steel-300">
        הפרופילים, הפרזול ושעות העבודה שאתה עובד איתם, במחיר שלך. מכאן הם נבחרים לכתב הכמויות של כל עבודה.
      </p>

      <label className="relative mt-4 block">
        <span className="sr-only">חיפוש במחירון</span>
        <Icon name="search" size={20} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-steel-500" />
        <input
          className="field ps-10"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש: 60×40, ציר, ספק..."
        />
      </label>

      {error && (
        <p className="mt-4 rounded-[10px] border border-primer bg-primer/15 p-3 text-primer-light" role="alert">
          {error}
        </p>
      )}
      {elements === null && !error && <p className="mt-6 text-steel-300">טוען...</p>}
      {elements !== null && grouped.length === 0 && (
        <p className="mt-8 text-center text-steel-300">
          {query ? 'לא נמצא. נסה מילה אחרת או הוסף פריט חדש.' : 'המחירון ריק. הוסף את הפריט הראשון.'}
        </p>
      )}

      <div className="mt-4 space-y-5">
        {grouped.map(([cat, items]) => (
          <div key={cat}>
            <h3 className="mb-1 text-sm font-semibold text-steel-300">{ELEMENT_CATEGORY_LABELS[cat]}</h3>
            <ul className="plate divide-y divide-steel-700 rounded-[10px]">
              {items.map((el) => (
                <li key={el.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(el)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start active:bg-steel-700"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{el.name}</span>
                      <span className="block text-sm text-steel-300">
                        {[
                          el.supplier_name,
                          el.weight_kg_per_unit ? `${fmtNum(el.weight_kg_per_unit)} ק״ג ${UNIT_PER[el.unit]}` : null,
                          el.stock_length_mm ? `מוט ${fmtNum(el.stock_length_mm / 1000)} מ׳` : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || ' '}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-end">
                      <span className="block font-semibold">{formatIls(el.unit_cost)}</span>
                      <span className="block text-sm text-steel-500">{UNIT_PER[el.unit]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 bg-gradient-to-t from-steel-900 via-steel-900/90 to-transparent pb-3 pt-6">
        <div className="mx-auto max-w-xl px-4">
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" />
            פריט חדש
          </button>
        </div>
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'פריט חדש' : 'עריכת פריט'}>
        {editing !== null && (
          <ElementForm
            key={editing === 'new' ? 'new' : editing.id}
            element={editing === 'new' ? null : editing}
            suppliers={suppliers}
            onSaved={saved}
            onRemoved={removed}
          />
        )}
      </Sheet>
    </section>
  );
}

function ElementForm({
  element,
  suppliers,
  onSaved,
  onRemoved,
}: {
  element: Element | null;
  suppliers: Supplier[];
  onSaved: (el: Element, isNew: boolean) => void;
  onRemoved: (id: number) => void;
}) {
  const [category, setCategory] = useState<ElementCategory>(element?.category ?? 'profile');
  const [name, setName] = useState(element?.name ?? '');
  const [unit, setUnit] = useState<Unit>(element?.unit ?? 'm');
  const [cost, setCost] = useState(element ? String(element.unit_cost) : '');
  const [weight, setWeight] = useState(element?.weight_kg_per_unit != null ? String(element.weight_kg_per_unit) : '');
  const [stock, setStock] = useState(
    element?.stock_length_mm != null ? String(element.stock_length_mm) : element ? '' : '6000',
  );
  const [supplierId, setSupplierId] = useState(element?.supplier_id != null ? String(element.supplier_id) : '');
  const [newSupplier, setNewSupplier] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [calcOpen, setCalcOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBar = category === 'profile' || category === 'pipe';
  const isSteel = isBar || category === 'plate';

  const pickCategory = (cat: ElementCategory) => {
    setCategory(cat);
    if (!element) setUnit(DEFAULT_UNIT[cat]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('תן לפריט שם, למשל "פרופיל 60×40×2".');
    if (!(Number(cost) >= 0) || cost === '') return setError('מלא מחיר.');
    const draft: ElementDraft = {
      category,
      name: name.trim(),
      unit,
      unit_cost: Number(cost),
      weight_kg_per_unit: weight ? Number(weight) : null,
      stock_length_mm: isBar && stock ? Number(stock) : null,
      supplier_id: supplierId && supplierId !== 'new' ? Number(supplierId) : null,
      ...(supplierId === 'new' && newSupplier.trim()
        ? { supplier_name: newSupplier.trim(), supplier_phone: newSupplierPhone.trim() }
        : {}),
    };
    setSaving(true);
    try {
      const saved = element ? await api.updateElement(element.id, draft) : await api.createElement(draft);
      onSaved(saved, !element);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!element) return;
    if (!confirmRemove) return setConfirmRemove(true);
    setSaving(true);
    try {
      await api.deleteElement(element.id);
      onRemoved(element.id);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset>
        <legend className="mb-2 font-semibold">סוג</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ORDER.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={category === cat}
              onClick={() => pickCategory(cat)}
              className={`min-h-11 rounded-full border px-3.5 text-[0.95rem] font-semibold ${
                category === cat ? 'border-hivis bg-hivis text-steel-950' : 'border-steel-700 text-steel-300'
              }`}
            >
              {ELEMENT_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block font-semibold">שם</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: פרופיל 60×40×2" />
      </label>

      {isSteel && (
        <div className="rounded-[10px] border border-steel-700">
          <button
            type="button"
            onClick={() => setCalcOpen((o) => !o)}
            aria-expanded={calcOpen}
            className="flex min-h-12 w-full items-center gap-2 px-4 text-start font-semibold"
          >
            <Icon name="scale" size={20} className="text-steel-300" />
            <span className="flex-1">חשב משקל ושם לפי מידות</span>
            <Icon name={calcOpen ? 'close' : 'plus'} size={18} className="text-steel-500" />
          </button>
          {calcOpen && (
            <WeightCalculator
              defaultShape={category === 'plate' ? 'plate' : category === 'pipe' ? 'round_tube' : 'rect_tube'}
              onApply={(n, kg, u) => {
                setName(n);
                setWeight(String(kg));
                setUnit(u);
                setCalcOpen(false);
              }}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block font-semibold">נמדד ב</span>
          <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_NAMES[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block font-semibold">מחיר {UNIT_PER[unit]}</span>
          <span className="relative block">
            <input
              className="field tnum ps-9"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              dir="ltr"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-steel-500">₪</span>
          </span>
        </label>
      </div>

      {isSteel && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block font-semibold">משקל ({UNIT_PER[unit]})</span>
            <span className="relative block">
              <input
                className="field tnum ps-12"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                dir="ltr"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm text-steel-500">
                ק״ג
              </span>
            </span>
          </label>
          {isBar && (
            <label className="block">
              <span className="mb-1.5 block font-semibold">אורך מוט מהספק</span>
              <span className="relative block">
                <input
                  className="field tnum ps-12"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  dir="ltr"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                />
                <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm text-steel-500">
                  מ״מ
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block font-semibold">ספק</span>
        <select className="field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">בלי ספק</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="new">+ ספק חדש</option>
        </select>
        <span className="mt-1.5 block text-sm text-steel-300">לפי הספק נבנית רשימת ההזמנה של כל עבודה.</span>
      </label>
      {supplierId === 'new' && (
        <div className="grid grid-cols-2 gap-3">
          <input className="field" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="שם הספק" />
          <input
            className="field"
            type="tel"
            dir="ltr"
            value={newSupplierPhone}
            onChange={(e) => setNewSupplierPhone(e.target.value)}
            placeholder="טלפון"
          />
        </div>
      )}

      {error && (
        <p className="text-primer-light" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? 'שומר...' : element ? 'שמור שינויים' : 'הוסף למחירון'}
      </button>

      {element && (
        <button
          type="button"
          onClick={remove}
          disabled={saving}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border font-semibold ${
            confirmRemove ? 'border-primer bg-primer text-soapstone' : 'border-steel-700 text-primer-light'
          }`}
        >
          <Icon name="trash" size={20} />
          {confirmRemove ? 'לחץ שוב כדי להסיר' : 'הסר מהמחירון'}
        </button>
      )}
      {element && <p className="-mt-3 text-center text-sm text-steel-500">עבודות קיימות שומרות את המחיר שהיה בהן.</p>}
    </form>
  );
}

function WeightCalculator({
  defaultShape,
  onApply,
}: {
  defaultShape: SteelShape;
  onApply: (name: string, kg: number, unit: Unit) => void;
}) {
  const [shape, setShape] = useState<SteelShape>(defaultShape);
  const [dims, setDims] = useState<string[]>([]);
  const spec = SHAPES[shape];
  const values = spec.dims.map((_, i) => Number(dims[i]) || 0);
  const ready = values.every((v) => v > 0);
  const kg = ready ? spec.kg(values) : 0;

  return (
    <div className="space-y-3 border-t border-steel-700 p-4">
      <select
        className="field"
        value={shape}
        onChange={(e) => {
          setShape(e.target.value as SteelShape);
          setDims([]);
        }}
      >
        {(Object.keys(SHAPES) as SteelShape[]).map((s) => (
          <option key={s} value={s}>
            {SHAPES[s].label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-2">
        {spec.dims.map((label, i) => (
          <label key={label} className="block">
            <span className="mb-1 block text-sm text-steel-300">{label} (מ״מ)</span>
            <input
              className="field tnum"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              dir="ltr"
              value={dims[i] ?? ''}
              onChange={(e) =>
                setDims((d) => {
                  const next = [...d];
                  next[i] = e.target.value;
                  return next;
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="tnum text-steel-300">
          {ready ? `${spec.name(values)}: ${fmtNum(kg)} ק״ג ${spec.unit === 'm' ? 'למטר' : 'למ״ר'}` : 'מלא את כל המידות'}
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onApply(spec.name(values), kg, spec.unit)}
          className="min-h-11 shrink-0 rounded-lg bg-soapstone px-4 font-semibold text-steel-950 disabled:opacity-40"
        >
          השתמש
        </button>
      </div>
    </div>
  );
}
