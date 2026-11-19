import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { ElementDraft } from '../lib/api.ts';
import { ELEMENT_CATEGORY_LABELS, UNITS, UNIT_PER } from '../core/types.ts';
import type { Element, ElementCategory, Material, Supplier, Unit } from '../core/types.ts';
import { formatIls } from '../core/money.ts';
import { SHAPES, kgFor } from '../core/steel.ts';
import type { SteelShape } from '../core/steel.ts';
import { FAMILIES, MATERIALS, familyDef, itemName, materialInfo } from '../core/catalog.ts';
import type { MaterialKey } from '../core/catalog.ts';
import { fmtNum } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { toast } from '../components/Toast.tsx';
import { ElementBrowser, GENERAL_FAMILY } from '../components/ElementBrowser.tsx';
import type { FamilyRef } from '../components/ElementBrowser.tsx';

const METAL: ElementCategory[] = ['profile', 'pipe', 'plate'];

/** First word of a name made from dimensions, when the family has no base word */
const SHAPE_BASE: Record<SteelShape, string> = {
  rect_tube: 'פרופיל',
  round_tube: 'צינור',
  angle: 'זוויתן',
  flat: 'פלח',
  round_bar: 'מוט עגול',
  square_bar: 'מוט מרובע',
  plate: 'פח',
};

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
  const [materials, setMaterials] = useState<Material[]>([]);
  const [catalog, setCatalog] = useState<{ total: number; missing: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Element | FamilyRef | 'new' | null>(null);

  const reload = () =>
    Promise.all([api.elements(), api.materials()]).then(([e, m]) => {
      setElements(e);
      setMaterials(m);
    });

  useEffect(() => {
    Promise.all([api.elements(), api.suppliers(), api.materials()])
      .then(([e, s, m]) => {
        setElements(e);
        setSuppliers(s);
        setMaterials(m);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    api.catalogStatus().then(setCatalog, () => undefined);
  }, []);

  const familiesByCategory = useMemo(() => {
    const map = new Map<ElementCategory, Set<string>>();
    for (const f of FAMILIES) map.set(f.category, (map.get(f.category) ?? new Set()).add(f.family));
    for (const e of elements ?? []) if (e.family) map.set(e.category, (map.get(e.category) ?? new Set()).add(e.family));
    return map;
  }, [elements]);

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

  const importCatalog = async () => {
    setImporting(true);
    try {
      const r = await api.importCatalog();
      await reload();
      setCatalog(await api.catalogStatus());
      toast(`נוספו ${r.added} פריטים${r.linked ? `, ${r.linked} קיימים חוברו לקטלוג` : ''}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setImporting(false);
    }
  };

  const hasByKg = (elements ?? []).some((e) => e.price_by_kg);

  return (
    <section>
      <a href="#/business" className="-ms-1 inline-flex min-h-11 items-center gap-0.5 px-1 font-medium text-accent">
        <Icon name="back" size={20} />
        עסק
      </a>
      <h1 className="text-[1.75rem] font-bold leading-tight">מחירון וחומרים</h1>
      <p className="mt-2 max-w-md text-muted">
        כל מה שאתה קונה ומוכר, לפי משפחות ומידות. מכאן נבחרות השורות לכתב הכמויות של כל עבודה.
      </p>

      {catalog && catalog.missing > 0 && (
        <div className="plate mt-4 rounded-md p-4">
          <p className="font-semibold">{catalog.missing === catalog.total ? 'קטלוג מוכן להוספה' : 'יש מידות חדשות בקטלוג'}</p>
          <p className="mt-1 text-sm text-muted">
            {catalog.missing} פריטים סטנדרטיים: פרופילים, זוויתנים, פלחים ומוטות בכל המידות, צינורות, קורות ופחים בברזל שחור,
            מגולוון, נירוסטה ואלומיניום, וגם אביזרי צנרת, פרזול, מתכלים וצביעה. פריטים שכבר יש לך נשארים כמו שהם.
          </p>
          <button type="button" onClick={importCatalog} disabled={importing} className="btn-primary mt-3">
            <Icon name="layers" />
            {importing ? 'מוסיף...' : 'הוסף את הקטלוג למחירון'}
          </button>
        </div>
      )}

      {hasByKg && materials.length > 0 && (
        <MaterialPrices
          materials={materials}
          onChanged={async (m, repriced) => {
            await reload();
            toast(`${m.name}: ${formatIls(m.price_per_kg)} לק״ג. ${repriced} מחירים עודכנו`);
          }}
        />
      )}

      <label className="relative mt-4 block">
        <span className="sr-only">חיפוש במחירון</span>
        <Icon name="search" size={20} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-faint" />
        <input
          className="field ps-10"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש: 60/40, צינור 8, ציר, ספק..."
        />
      </label>

      {error && (
        <p className="mt-4 rounded-md border border-danger bg-danger-soft p-3 text-danger" role="alert">
          {error}
        </p>
      )}
      {elements === null && !error && <p className="mt-6 text-muted">טוען...</p>}
      {elements !== null && elements.length === 0 && (
        <p className="mt-8 text-center text-muted">המחירון ריק. הוסף את הקטלוג או פריט ראשון.</p>
      )}

      {elements !== null && elements.length > 0 && (
        <ElementBrowser
          elements={elements}
          materials={materials}
          query={query}
          onPick={(el) => setEditing(el)}
          onAdd={(ref) => setEditing(ref)}
        />
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 bg-gradient-to-t from-page via-page/90 to-transparent pb-3 pt-6">
        <div className="mx-auto max-w-xl px-4">
          <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" />
            פריט חדש
          </button>
        </div>
      </div>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === null || editing === 'new' ? 'פריט חדש' : 'id' in editing ? 'עריכת פריט' : `${editing.family}: פריט חדש`}
      >
        {editing !== null && (
          <ElementForm
            key={editing === 'new' ? 'new' : 'id' in editing ? editing.id : `${editing.family}:${editing.material}`}
            element={editing !== 'new' && 'id' in editing ? editing : null}
            preset={editing !== 'new' && !('id' in editing) ? editing : null}
            suppliers={suppliers}
            materials={materials}
            familiesByCategory={familiesByCategory}
            onSaved={saved}
            onRemoved={removed}
          />
        )}
      </Sheet>
    </section>
  );
}

/** One price per kg for each material; every size priced by weight follows it. */
function MaterialPrices({
  materials,
  onChanged,
}: {
  materials: Material[];
  onChanged: (m: Material, repriced: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(materials.map((m) => [m.key, m.price_per_kg ? String(m.price_per_kg) : ''])),
  );
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (m: Material) => {
    const v = Number(draft[m.key]);
    if (!Number.isFinite(v) || v < 0 || v === m.price_per_kg || draft[m.key] === '') return;
    setBusy(m.key);
    try {
      const r = await api.setMaterialPrice(m.key, v);
      await onChanged(r.material, r.repriced);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <fieldset className="plate mt-4 rounded-md p-4">
      <legend className="sr-only">מחיר לק״ג</legend>
      <p className="font-semibold">מחיר לק״ג, לפני מע״מ</p>
      <p className="text-sm text-muted">מחיר אחד לכל חומר, וכל המידות שמתומחרות לפי משקל מתעדכנות לבד.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {materials.map((m) => (
          <label key={m.key} className="block">
            <span className="mb-1 block text-sm font-semibold">{m.name}</span>
            <span className="relative block">
              <input
                className={`field tnum ps-9 ${m.price_per_kg ? '' : 'border-accent'}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                dir="ltr"
                value={draft[m.key] ?? ''}
                placeholder="לא נקבע"
                disabled={busy === m.key}
                onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
                onBlur={() => void save(m)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-faint">₪</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ElementForm({
  element,
  preset,
  suppliers,
  materials,
  familiesByCategory,
  onSaved,
  onRemoved,
}: {
  element: Element | null;
  /** "Add size" inside a family: category, family and material come filled in */
  preset: FamilyRef | null;
  suppliers: Supplier[];
  materials: Material[];
  familiesByCategory: Map<ElementCategory, Set<string>>;
  onSaved: (el: Element, isNew: boolean) => void;
  onRemoved: (id: number) => void;
}) {
  const presetDef = familyDef(preset?.family);
  const startCategory = element?.category ?? preset?.category ?? 'profile';
  const [category, setCategory] = useState<ElementCategory>(startCategory);
  const [family, setFamily] = useState(element?.family ?? (preset && preset.family !== GENERAL_FAMILY ? preset.family : ''));
  const [material, setMaterial] = useState(element?.material ?? preset?.material ?? (METAL.includes(startCategory) ? 'black' : ''));
  const [size, setSize] = useState(element?.size ?? '');
  const [name, setName] = useState(element?.name ?? '');
  const [unit, setUnit] = useState<Unit>(element?.unit ?? presetDef?.unit ?? DEFAULT_UNIT[startCategory]);
  const [cost, setCost] = useState(element ? String(element.unit_cost) : '');
  const [weight, setWeight] = useState(element?.weight_kg_per_unit != null ? String(element.weight_kg_per_unit) : '');
  const [stock, setStock] = useState(
    element?.stock_length_mm != null
      ? String(element.stock_length_mm)
      : element
        ? ''
        : String(presetDef?.stock ?? (startCategory === 'plate' ? '' : 6000)),
  );
  const [byKg, setByKg] = useState(element ? Boolean(element.price_by_kg) : METAL.includes(startCategory));
  const [supplierId, setSupplierId] = useState(element?.supplier_id != null ? String(element.supplier_id) : '');
  const [newSupplier, setNewSupplier] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [calcOpen, setCalcOpen] = useState(Boolean(preset && presetDef?.shape));
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBar = category === 'profile' || category === 'pipe';
  const isMetal = METAL.includes(category);
  const def = familyDef(family);
  const mat = materials.find((m) => m.key === material);
  const kgPrice = mat?.price_per_kg ?? 0;
  const computed = Math.round((Number(weight) || 0) * kgPrice * 100) / 100;
  const pricedByKg = isMetal && byKg && Boolean(material) && Number(weight) > 0;
  const familyOptions = [...(familiesByCategory.get(category) ?? [])];

  const pickCategory = (cat: ElementCategory) => {
    setCategory(cat);
    if (!element) {
      setUnit(DEFAULT_UNIT[cat]);
      setByKg(METAL.includes(cat));
      if (METAL.includes(cat) && !material) setMaterial('black');
      if (!METAL.includes(cat)) setMaterial('');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('תן לפריט שם, למשל "פרופיל 60/40/2".');
    if (!pricedByKg && (!(Number(cost) >= 0) || cost === '')) return setError('מלא מחיר.');
    const draft: ElementDraft = {
      category,
      name: name.trim(),
      unit,
      unit_cost: pricedByKg ? computed : Number(cost),
      weight_kg_per_unit: weight ? Number(weight) : null,
      stock_length_mm: isBar && stock ? Number(stock) : null,
      supplier_id: supplierId && supplierId !== 'new' ? Number(supplierId) : null,
      family: family.trim() || null,
      material: isMetal && material ? material : null,
      size: size.trim() || null,
      price_by_kg: pricedByKg,
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
      {!preset && (
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
                  category === cat ? 'border-accent bg-accent text-white' : 'border-line text-muted'
                }`}
              >
                {ELEMENT_CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className={`grid gap-3 ${isMetal ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <label className="block">
          <span className="mb-1.5 block font-semibold">משפחה</span>
          <input
            className="field"
            list="family-options"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            placeholder="למשל: צירים"
          />
          <datalist id="family-options">
            {familyOptions.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        {isMetal && (
          <label className="block">
            <span className="mb-1.5 block font-semibold">חומר</span>
            <select className="field" value={material} onChange={(e) => setMaterial(e.target.value)}>
              {MATERIALS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {isMetal && (
        <div className="rounded-md border border-line">
          <button
            type="button"
            onClick={() => setCalcOpen((o) => !o)}
            aria-expanded={calcOpen}
            className="flex min-h-12 w-full items-center gap-2 px-4 text-start font-semibold"
          >
            <Icon name="scale" size={20} className="text-muted" />
            <span className="flex-1">שם, מידה ומשקל לפי מידות</span>
            <Icon name={calcOpen ? 'close' : 'plus'} size={18} className="text-faint" />
          </button>
          {calcOpen && (
            <WeightCalculator
              defaultShape={def?.shape ?? (category === 'plate' ? 'plate' : category === 'pipe' ? 'round_tube' : 'rect_tube')}
              density={materialInfo(material)?.density ?? 7.85}
              onApply={(dims, shape, kg, u) => {
                const sizeLabel = sizeFor(shape, dims);
                setSize(sizeLabel);
                setName(itemName(def?.base || SHAPE_BASE[shape], sizeLabel, (material || null) as MaterialKey | null));
                setWeight(String(kg));
                setUnit(u);
                setCalcOpen(false);
              }}
            />
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block font-semibold">שם</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: פרופיל 60/40/2" />
      </label>

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
        {isMetal ? (
          <label className="block">
            <span className="mb-1.5 block font-semibold">מידה (לתפריט)</span>
            <input className="field tnum" value={size} onChange={(e) => setSize(e.target.value)} placeholder="60/40/2" />
          </label>
        ) : (
          <PriceField unit={unit} value={cost} onChange={setCost} />
        )}
      </div>

      {isMetal && (
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
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm text-faint">ק״ג</span>
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
                <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm text-faint">מ״מ</span>
              </span>
            </label>
          )}
        </div>
      )}

      {isMetal && (
        <div className="rounded-md border border-line p-3">
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="h-6 w-6 accent-accent" checked={byKg} onChange={(e) => setByKg(e.target.checked)} />
            <span className="font-semibold">מחיר לפי משקל</span>
          </label>
          {byKg ? (
            <p className="tnum mt-1 text-muted">
              {!material || !(Number(weight) > 0)
                ? 'צריך חומר ומשקל כדי לחשב.'
                : kgPrice > 0
                  ? `${fmtNum(Number(weight))} ק״ג × ${formatIls(kgPrice)} לק״ג = ${formatIls(computed)} ${UNIT_PER[unit]}`
                  : `עוד לא נקבע מחיר לק״ג ל${mat?.name ?? 'חומר הזה'}. קבע אותו בראש המחירון.`}
            </p>
          ) : (
            <div className="mt-2">
              <PriceField unit={unit} value={cost} onChange={setCost} />
            </div>
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
        <span className="mt-1.5 block text-sm text-muted">לפי הספק נבנית רשימת ההזמנה של כל עבודה.</span>
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
        <p className="text-danger" role="alert">
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
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-md border font-semibold ${
            confirmRemove ? 'border-danger bg-danger text-white' : 'border-line text-danger'
          }`}
        >
          <Icon name="trash" size={20} />
          {confirmRemove ? 'לחץ שוב כדי להסיר' : 'הסר מהמחירון'}
        </button>
      )}
      {element && <p className="-mt-3 text-center text-sm text-faint">עבודות קיימות שומרות את המחיר שהיה בהן.</p>}
    </form>
  );
}

function PriceField({ unit, value, onChange }: { unit: Unit; value: string; onChange: (v: string) => void }) {
  return (
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
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-faint">₪</span>
      </span>
    </label>
  );
}

/** Size label for the menu, in the catalog's style */
function sizeFor(shape: SteelShape, d: number[]): string {
  if (shape === 'plate') return `${d[0]} מ״מ`;
  if (shape === 'round_bar') return `Ø${d[0]}`;
  if (shape === 'square_bar') return `${d[0]}/${d[0]}`;
  if (shape === 'round_tube') return `Ø${d.join('/')}`;
  return d.join('/');
}

function WeightCalculator({
  defaultShape,
  density,
  onApply,
}: {
  defaultShape: SteelShape;
  density: number;
  onApply: (dims: number[], shape: SteelShape, kg: number, unit: Unit) => void;
}) {
  const [shape, setShape] = useState<SteelShape>(defaultShape);
  const [dims, setDims] = useState<string[]>([]);
  const spec = SHAPES[shape];
  const values = spec.dims.map((_, i) => Number(dims[i]) || 0);
  const ready = values.every((v) => v > 0);
  const kg = ready ? kgFor(shape, values, density) : 0;

  return (
    <div className="space-y-3 border-t border-line p-4">
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
            <span className="mb-1 block text-sm text-muted">{label} (מ״מ)</span>
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
        <span className="tnum text-muted">
          {ready ? `${sizeFor(shape, values)}: ${fmtNum(kg)} ק״ג ${spec.unit === 'm' ? 'למטר' : 'למ״ר'}` : 'מלא את כל המידות'}
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onApply(values, shape, kg, spec.unit)}
          className="min-h-11 shrink-0 rounded-lg bg-ink px-4 font-semibold text-white disabled:opacity-40"
        >
          השתמש
        </button>
      </div>
    </div>
  );
}
