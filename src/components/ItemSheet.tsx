import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { ItemDraft } from '../lib/api.ts';
import { UNITS, UNIT_LABELS, UNIT_PER } from '../core/types.ts';
import type { Element, JobItem, Unit } from '../core/types.ts';
import { formatIls } from '../core/money.ts';
import { fmtNum } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { ElementBrowser } from './ElementBrowser.tsx';

const UNIT_NAMES: Record<Unit, string> = {
  m: 'מטר',
  kg: 'ק״ג',
  unit: 'יחידה',
  hour: 'שעת עבודה',
  m2: 'מ״ר',
  joint: 'תפר ריתוך',
  day: 'יום',
};

type Mode = 'pieces' | 'amount';

function initialMode(item: JobItem | null): Mode {
  if (!item) return 'amount';
  return item.unit === 'm' && item.pieces != null && item.length_mm != null ? 'pieces' : 'amount';
}

/** Add or edit one line of the bill of quantities. */
export function ItemForm({
  jobId,
  item,
  elements,
  groups,
  onSaved,
  onDeleted,
}: {
  jobId: number;
  item: JobItem | null;
  elements: Element[];
  groups: string[];
  onSaved: (item: JobItem, isNew: boolean) => void;
  onDeleted: (itemId: number) => void;
}) {
  const [elementId, setElementId] = useState<string>(item?.element_id != null ? String(item.element_id) : '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [group, setGroup] = useState(item?.group_name ?? '');
  const [unit, setUnit] = useState<Unit>(item?.unit ?? 'unit');
  const [unitCost, setUnitCost] = useState(item ? String(item.unit_cost) : '');
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : '');
  const [pieces, setPieces] = useState(item?.pieces != null ? String(item.pieces) : '');
  const [length, setLength] = useState(item?.length_mm != null ? String(item.length_mm) : '');
  const [mode, setMode] = useState<Mode>(initialMode(item));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const picked = elements.find((e) => String(e.id) === elementId);

  const usePieces = unit === 'm' && mode === 'pieces';
  const qty = usePieces ? ((Number(pieces) || 0) * (Number(length) || 0)) / 1000 : Number(quantity) || 0;
  const total = qty * (Number(unitCost) || 0);

  const pickElement = (id: string) => {
    const previous = elements.find((e) => String(e.id) === elementId);
    const el = elements.find((e) => String(e.id) === id);
    setElementId(id);
    setPicking(false);
    if (!el) return;
    if (!description.trim() || description === previous?.name) setDescription(el.name);
    setUnit(el.unit);
    setUnitCost(String(el.unit_cost));
    if (el.unit === 'm' && (el.category === 'profile' || el.category === 'pipe')) setMode('pieces');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!description.trim()) return setError('כתוב מה השורה, למשל "ציר כבד" או "פרופיל 60/40".');
    if (usePieces && (!(Number(pieces) > 0) || !(Number(length) > 0))) {
      return setError('מלא כמה חתיכות ואת האורך של כל אחת במ״מ.');
    }
    if (!usePieces && !(Number(quantity) >= 0)) return setError('הכמות צריכה להיות מספר.');

    const draft: ItemDraft = {
      element_id: elementId ? Number(elementId) : null,
      group_name: group.trim() || null,
      description: description.trim(),
      unit,
      unit_cost: Number(unitCost) || 0,
      quantity: qty,
      pieces: usePieces ? Number(pieces) : null,
      length_mm: usePieces ? Number(length) : null,
    };
    setSaving(true);
    try {
      const saved = item ? await api.updateItem(jobId, item.id, draft) : await api.createItem(jobId, draft);
      onSaved(saved, !item);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setSaving(true);
    try {
      await api.deleteItem(jobId, item.id);
      onDeleted(item.id);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  if (picking) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setPicking(false)}
          className="-ms-2 inline-flex min-h-11 items-center gap-1 px-2 font-semibold text-steel-300"
        >
          <Icon name="back" size={20} />
          חזרה לשורה
        </button>
        <label className="relative mt-2 block">
          <span className="sr-only">חיפוש במחירון</span>
          <Icon name="search" size={20} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-steel-500" />
          <input
            className="field ps-10"
            type="search"
            value={pickQuery}
            onChange={(e) => setPickQuery(e.target.value)}
            placeholder="חיפוש: 60/40, צינור 8, ציר..."
          />
        </label>
        <ElementBrowser
          elements={elements}
          query={pickQuery}
          selectedId={picked?.id ?? null}
          onPick={(el) => pickElement(String(el.id))}
        />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {elements.length > 0 && (
        <div>
          <span className="mb-1.5 block font-semibold">מהמחירון</span>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex min-h-14 w-full items-center gap-3 rounded-[10px] border border-steel-700 bg-steel-950 px-3 text-start"
          >
            <Icon name="tag" size={20} className="shrink-0 text-hivis" />
            <span className="min-w-0 flex-1">
              {picked ? (
                <>
                  <span className="block truncate font-semibold">{picked.name}</span>
                  <span className={`tnum block text-sm ${picked.unit_cost > 0 ? 'text-steel-300' : 'text-hivis'}`}>
                    {picked.unit_cost > 0 ? `${formatIls(picked.unit_cost)} ${UNIT_PER[picked.unit]}` : 'חסר מחיר במחירון'}
                  </span>
                </>
              ) : (
                <span className="block text-steel-300">בחר פרופיל, פרזול, צביעה...</span>
              )}
            </span>
            <span className="shrink-0 text-sm font-semibold text-hivis">{picked ? 'החלף' : 'בחר'}</span>
          </button>
          {picked ? (
            <button
              type="button"
              onClick={() => setElementId('')}
              className="mt-1 min-h-11 text-sm text-steel-300 underline underline-offset-4"
            >
              הפוך לשורה חופשית
            </button>
          ) : (
            <span className="mt-1.5 block text-sm text-steel-300">או כתוב שורה חופשית למטה. בחירה מהמחירון ממלאת שם, יחידה ומחיר.</span>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 block font-semibold">מה זה?</span>
        <input
          className="field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="למשל: מסגרת 60/40 – אנכיים"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block font-semibold">חלק בעבודה</span>
        <input
          className="field"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="למשל: כנפיים, עמודים, פרזול"
          list="item-groups"
        />
        <datalist id="item-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <span className="mt-1.5 block text-sm text-steel-300">מקבץ שורות יחד בכתב הכמויות. לא חובה.</span>
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
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-steel-500">₪</span>
          </span>
        </label>
      </div>

      {unit === 'm' && (
        <div className="flex rounded-[10px] border border-steel-700 p-1" role="group" aria-label="איך למדוד">
          {(
            [
              ['pieces', 'חתיכות לפי מידה'],
              ['amount', 'רק מטרים'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-11 flex-1 rounded-lg font-semibold ${mode === m ? 'bg-soapstone text-steel-950' : 'text-steel-300'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {usePieces ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block font-semibold">כמה חתיכות</span>
            <input
              className="field tnum"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              dir="ltr"
              value={pieces}
              onChange={(e) => setPieces(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-semibold">אורך כל אחת</span>
            <span className="relative block">
              <input
                className="field tnum ps-12"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                dir="ltr"
                value={length}
                onChange={(e) => setLength(e.target.value)}
              />
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm text-steel-500">
                מ״מ
              </span>
            </span>
          </label>
        </div>
      ) : (
        <label className="block">
          <span className="mb-1.5 block font-semibold">כמות ({UNIT_LABELS[unit]})</span>
          <input
            className="field tnum"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            dir="ltr"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
      )}

      <div className="flex items-baseline justify-between rounded-[10px] bg-steel-950 px-4 py-3">
        <span className="text-steel-300">
          {fmtNum(qty)} {UNIT_LABELS[unit]} × {formatIls(Number(unitCost) || 0)}
        </span>
        <span className="tnum text-xl font-semibold">{formatIls(total)}</span>
      </div>
      {usePieces && (
        <p className="-mt-3 text-sm text-steel-300">החיתוך מהמוטות והפחת מחושבים אוטומטית במסך העבודה.</p>
      )}

      {error && (
        <p className="text-primer-light" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? 'שומר...' : item ? 'שמור שינויים' : 'הוסף שורה'}
      </button>

      {item && (
        <button
          type="button"
          onClick={remove}
          disabled={saving}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border font-semibold ${
            confirmDelete ? 'border-primer bg-primer text-soapstone' : 'border-steel-700 text-primer-light'
          }`}
        >
          <Icon name="trash" size={20} />
          {confirmDelete ? 'לחץ שוב כדי למחוק' : 'מחק שורה'}
        </button>
      )}
    </form>
  );
}
