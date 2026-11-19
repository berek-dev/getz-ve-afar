/**
 * Building a model by hand, finger mode (phone first): a grid of typed spacings, tap two grid points to place a
 * member, tap a member to change it, tap a measurement to type a new one. The design compiles (src/core/design.ts)
 * to the same layout the 3D view, shop drawing, cut list and price use. Loaded with the model step.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { JobDetail, JobModel } from '../lib/api.ts';
import {
  COMMON_SIZES,
  PROFILE_LABELS,
  addBay,
  addInfill,
  addMember,
  compileDesign,
  gridLines,
  memberCutLengths,
  newDesign,
  parseSize,
  readDesign,
  removeInfill,
  removeLastBay,
  removeMember,
  setSpacing,
  sizeText,
  updateInfill,
  updateMember,
  xLineName,
  zLineName,
} from '../core/design.ts';
import type { Design, DesignNode, GridAxis, ProfileChoice } from '../core/design.ts';
import { PROFILES, cutList, halfExtent, prepareScene, sectionAxes, sectionName, sub, norm } from '../core/scene.ts';
import type { Profile, ResolvedMember, Vec3 } from '../core/scene.ts';
import { fmtNum } from '../lib/format.ts';
import { ModelView } from './ModelView.tsx';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toast.tsx';

type ViewKind = 'front' | 'side' | 'plan' | '3d';
interface View {
  kind: ViewKind;
  line: number;
}
type Selected = { kind: 'member' | 'infill'; id: string } | null;
type SheetState = { kind: 'grid' } | { kind: 'profile' } | { kind: 'dim'; axis: GridAxis; index: number } | null;

const AXIS_I: Record<GridAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
/** For each 2D view: the axis across the screen, the axis up/down the screen, and the axis the view looks along */
const VIEW_AXES: Record<Exclude<ViewKind, '3d'>, { u: GridAxis; v: GridAxis; p: GridAxis }> = {
  front: { u: 'x', v: 'y', p: 'z' },
  side: { u: 'z', v: 'y', p: 'x' },
  plan: { u: 'x', v: 'z', p: 'y' },
};
const VIEW_LABELS: Record<ViewKind, string> = { front: 'חזית', side: 'צד', plan: 'מבט על', '3d': 'תלת־ממד' };
const AXIS_LABELS: Record<GridAxis, string> = { x: 'רוחב', y: 'גבהים', z: 'עומק' };

const DEFAULT_PROFILE: ProfileChoice = { profile: 'rect_tube', size: [60, 60, 3] };
const draftKey = (jobId: number) => `gva:design-draft:${jobId}`;
const profileKey = 'gva:builder-profile';

function loadJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the draft lives in memory only
  }
}

const lineName = (axis: GridAxis, i: number, grid: Design['grid']) =>
  axis === 'x' ? xLineName(i) : axis === 'z' ? zLineName(i) : fmtNum(gridLines(grid.y).at(i) ?? 0);

export function DesignBuilder({ job, model, onSaved, after }: { job: JobDetail; model: JobModel; onSaved: (m: JobModel) => void; after?: ReactNode }) {
  const savedDesign = useMemo(() => readDesign((model.layout as { design?: unknown } | null)?.design), [model.layout]);
  const [design, setDesign] = useState<Design>(() => readDesign(loadJson(draftKey(job.id))) ?? savedDesign ?? newDesign());
  const [history, setHistory] = useState<Design[]>([]);
  const [view, setView] = useState<View>({ kind: 'front', line: 0 });
  const [pending, setPending] = useState<DesignNode | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [current, setCurrent] = useState<ProfileChoice>(() => loadJson<ProfileChoice>(profileKey) ?? DEFAULT_PROFILE);
  const [saving, setSaving] = useState(false);

  const savedText = useMemo(() => (savedDesign ? JSON.stringify(savedDesign) : ''), [savedDesign]);
  const dirty = JSON.stringify(design) !== savedText;
  useEffect(() => saveJson(draftKey(job.id), dirty ? design : null), [design, dirty, job.id]);

  const layout = useMemo(() => compileDesign(design, job.title), [design, job.title]);
  const prepared = useMemo(() => prepareScene(layout), [layout]);
  const usable = prepared.errors.length === 0 && prepared.scene.members.length > 0;
  const cut = useMemo(() => (usable ? cutList(prepared.scene) : null), [usable, prepared]);
  const lengths = useMemo(() => memberCutLengths(design), [design]);

  /** Every change goes through here, so one tap of "undo" takes it back */
  const change = (next: Design) => {
    if (next === design) return;
    setHistory((h) => [...h.slice(-49), design]);
    setDesign(next);
  };
  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setDesign(prev);
    setSelected(null);
    setPending(null);
  };

  const tapNode = (n: DesignNode) => {
    setSelected(null);
    if (!pending) return setPending(n);
    if (pending.join() === n.join()) return setPending(null);
    const { design: next, id } = addMember(design, pending, n, current);
    if (id) change(next);
    setPending(n); // keep drawing from here
  };

  const pickProfile = (c: ProfileChoice) => {
    setCurrent(c);
    saveJson(profileKey, c);
  };

  const save = async () => {
    if (!usable) return toast('צריך לפחות חלק אחד כדי לשמור');
    setSaving(true);
    try {
      const m = await api.saveModel(job.id, layout, { source: 'builder', mode: savedDesign ? 'edit' : 'new' });
      saveJson(draftKey(job.id), null);
      onSaved(m);
      toast('נשמר');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    saveJson(draftKey(job.id), null);
    setHistory((h) => [...h, design]);
    setDesign(savedDesign ?? newDesign());
    setSelected(null);
    setPending(null);
  };

  const axes = view.kind === '3d' ? null : VIEW_AXES[view.kind];
  const planeLines = axes ? design.grid[axes.p].length + 1 : 1;
  const line = Math.min(view.line, planeLines - 1);
  const setKind = (kind: ViewKind) => {
    setView({ kind, line: 0 });
    setPending(null);
  };

  const sel = selected;
  const selMember = sel?.kind === 'member' ? design.members.find((m) => m.id === sel.id) : undefined;
  const selInfill = sel?.kind === 'infill' ? design.infills.find((f) => f.id === sel.id) : undefined;

  return (
    <div>
      {model.layout != null && !savedDesign && (
        <p className="mb-3 rounded-md bg-accent-soft px-3 py-2.5 text-[0.9rem]">ההדמיה הנוכחית נבנתה בלי רשת. שמירה כאן תיצור גרסה חדשה במקומה, ואפשר לבטל.</p>
      )}

      <div className="grid grid-cols-4 rounded-md border border-line-strong bg-card p-0.5" role="tablist" aria-label="תצוגה">
        {(['front', 'side', 'plan', '3d'] as ViewKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view.kind === k}
            onClick={() => setKind(k)}
            className={`min-h-10 rounded-[5px] text-[0.85rem] font-semibold ${view.kind === k ? 'bg-ink text-white' : 'text-muted'}`}
          >
            {VIEW_LABELS[k]}
          </button>
        ))}
      </div>

      {axes && (
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView({ ...view, line: Math.max(0, line - 1) })}
            disabled={line === 0}
            aria-label="הקו הקודם"
            className="grid h-10 w-10 place-items-center rounded-md text-ink disabled:opacity-30"
          >
            <Icon name="back" size={20} />
          </button>
          <span className="min-w-0 flex-1 text-center text-[0.85rem] text-muted">
            {axes.p === 'y' ? `גובה ${lineName('y', line, design.grid)}` : `קו ${lineName(axes.p, line, design.grid)}`}
            {planeLines > 1 ? ` (${line + 1} מתוך ${planeLines})` : ''}
          </span>
          <button
            type="button"
            onClick={() => setView({ ...view, line: Math.min(planeLines - 1, line + 1) })}
            disabled={line >= planeLines - 1}
            aria-label="הקו הבא"
            className="grid h-10 w-10 place-items-center rounded-md text-ink disabled:opacity-30"
          >
            <Icon name="forward" size={20} />
          </button>
        </div>
      )}

      <div className="mt-1">
        {view.kind === '3d' ? (
          usable && cut ? (
            <ModelView prepared={prepared} cut={cut} designKey="builder" title={job.title} />
          ) : (
            <p className="plate rounded-md p-5 text-center text-muted">עוד אין חלקים. בחזית, גע בשתי נקודות ברשת.</p>
          )
        ) : axes && axes.u === 'z' && design.grid.z.length === 0 ? (
          <p className="plate rounded-md p-5 text-center text-muted">
            אין עומק. מוסיפים עומק ב
            <button type="button" onClick={() => setSheet({ kind: 'grid' })} className="font-semibold text-accent underline underline-offset-4">
              רשת
            </button>
            .
          </p>
        ) : axes ? (
          <GridCanvas
            design={design}
            members={prepared.scene.members}
            axes={axes}
            line={line}
            pending={pending}
            selected={selected}
            onNode={tapNode}
            onPick={(s) => {
              setPending(null);
              setSelected(s);
            }}
            onDim={(axis, index) => setSheet({ kind: 'dim', axis, index })}
          />
        ) : null}
      </div>

      {view.kind !== '3d' && (
        <p className="mt-1.5 px-1 text-[0.85rem] text-muted">
          {pending ? 'גע בנקודה הבאה כדי להוסיף חלק, או שוב באותה נקודה כדי לסיים.' : 'גע בשתי נקודות כדי להוסיף חלק. גע בחלק או במידה כדי לשנות.'}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => setSheet({ kind: 'profile' })} className="btn-secondary min-h-11 flex-1 px-3 text-[0.9rem]">
          <Icon name="frame" size={18} />
          <span className="truncate">{sectionName(current.profile, current.size, design.material)}</span>
        </button>
        <button type="button" onClick={() => setSheet({ kind: 'grid' })} className="btn-secondary min-h-11 px-3 text-[0.9rem]">
          <Icon name="ruler" size={18} />
          רשת
        </button>
        <button type="button" onClick={undo} disabled={history.length === 0} aria-label="בטל" className="btn-secondary min-h-11 px-3 disabled:opacity-40">
          <Icon name="undo" size={18} />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={!dirty || saving || !usable} className="btn-primary flex-1 disabled:opacity-50">
          <Icon name="check" />
          {saving ? 'שומר...' : dirty ? 'שמור' : 'נשמר'}
        </button>
        {dirty && savedDesign && (
          <button type="button" onClick={discard} className="min-h-11 shrink-0 px-2 text-[0.9rem] text-muted underline underline-offset-4">
            בטל שינויים
          </button>
        )}
      </div>
      {cut && (
        <p className="tnum mt-1.5 px-1 text-[0.85rem] text-muted">
          {cut.pieces.reduce((s, p) => s + p.count, 0)} חלקים, בערך {fmtNum(Math.round(cut.totalKg))} ק״ג
        </p>
      )}

      {after}

      <Sheet open={selMember !== undefined} onClose={() => setSelected(null)} title={selMember ? sectionName(selMember.profile, selMember.size, design.material) : ''}>
        {selMember && (
          <MemberEditor
            key={selMember.id}
            design={design}
            id={selMember.id}
            length={lengths.get(selMember.id) ?? 0}
            onChange={change}
            onClose={() => setSelected(null)}
          />
        )}
      </Sheet>
      <Sheet open={selInfill !== undefined} onClose={() => setSelected(null)} title="מילוי">
        {selInfill && (
          <InfillEditor
            key={selInfill.id}
            design={design}
            id={selInfill.id}
            onChange={change}
            onClose={() => setSelected(null)}
          />
        )}
      </Sheet>
      <Sheet open={sheet?.kind === 'profile'} onClose={() => setSheet(null)} title="פרופיל לחלקים חדשים">
        <ProfilePicker
          value={current}
          onChange={(c) => {
            pickProfile(c);
            setSheet(null);
          }}
        />
      </Sheet>
      <Sheet open={sheet?.kind === 'grid'} onClose={() => setSheet(null)} title="רשת">
        <GridEditor design={design} onChange={change} />
      </Sheet>
      <Sheet open={sheet?.kind === 'dim'} onClose={() => setSheet(null)} title={sheet?.kind === 'dim' ? `${AXIS_LABELS[sheet.axis]}: שדה ${sheet.index + 1}` : ''}>
        {sheet?.kind === 'dim' && (
          <NumberEditor
            key={`${sheet.axis}${sheet.index}`}
            value={design.grid[sheet.axis][sheet.index]}
            onDone={(v) => {
              change(setSpacing(design, sheet.axis, sheet.index, v));
              setSheet(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ canvas

const W = 360;
const M = { left: 60, right: 18, top: 30, bottom: 50 };
const MAX_H = 380;

function GridCanvas({
  design,
  members,
  axes,
  line,
  pending,
  selected,
  onNode,
  onPick,
  onDim,
}: {
  design: Design;
  members: ResolvedMember[];
  axes: { u: GridAxis; v: GridAxis; p: GridAxis };
  line: number;
  pending: DesignNode | null;
  selected: Selected;
  onNode: (n: DesignNode) => void;
  onPick: (s: Selected) => void;
  onDim: (axis: GridAxis, index: number) => void;
}) {
  const { grid } = design;
  const U = gridLines(grid[axes.u]);
  const V = gridLines(grid[axes.v]);
  const plane = gridLines(grid[axes.p]).at(line) ?? 0;
  const ui = AXIS_I[axes.u];
  const vi = AXIS_I[axes.v];
  const pi = AXIS_I[axes.p];
  const uMax = Math.max(U.at(-1) ?? 0, 1);
  const vMax = Math.max(V.at(-1) ?? 0, 1);
  const k = Math.min((W - M.left - M.right) / uMax, (MAX_H - M.top - M.bottom) / vMax);
  const H = M.top + vMax * k + M.bottom;
  const up = axes.v === 'y';
  const sx = (u: number) => M.left + u * k;
  const sy = (v: number) => (up ? M.top + (vMax - v) * k : M.top + v * k);
  const nodeAt = (a: number, b: number): DesignNode => {
    const n: DesignNode = [0, 0, 0];
    n[ui] = a;
    n[vi] = b;
    n[pi] = line;
    return n;
  };

  // Members lying in this plane are drawn along their length; ones crossing it, as their section
  const inPlane: { m: ResolvedMember; x1: number; y1: number; x2: number; y2: number; w: number }[] = [];
  const crossing: { m: ResolvedMember; x: number; y: number; w: number; h: number }[] = [];
  for (const m of members) {
    const a = m.from;
    const b = m.to;
    if (Math.abs(a[pi] - plane) < 1 && Math.abs(b[pi] - plane) < 1) {
      const d = norm(sub(b, a));
      const perp: Vec3 = [0, 0, 0];
      perp[ui] = -d[vi];
      perp[vi] = d[ui];
      const { f, n } = sectionAxes(d);
      inPlane.push({ m, x1: sx(a[ui]), y1: sy(a[vi]), x2: sx(b[ui]), y2: sy(b[vi]), w: Math.max(3, 2 * halfExtent(m, f, n, perp) * k) });
    } else if (Math.min(a[pi], b[pi]) <= plane + 1 && Math.max(a[pi], b[pi]) >= plane - 1) {
      const d = norm(sub(b, a));
      if (Math.abs(d[pi]) < 0.99) continue;
      const { f, n } = sectionAxes(d);
      const eu: Vec3 = [0, 0, 0];
      eu[ui] = 1;
      const ev: Vec3 = [0, 0, 0];
      ev[vi] = 1;
      crossing.push({ m, x: sx(a[ui]), y: sy(a[vi]), w: Math.max(6, 2 * halfExtent(m, f, n, eu) * k), h: Math.max(6, 2 * halfExtent(m, f, n, ev) * k) });
    }
  }
  const pickOf = (id: string): Selected => {
    const base = id.split('#')[0];
    return design.infills.some((f) => f.id === base) ? { kind: 'infill', id: base } : { kind: 'member', id: base };
  };
  const isSelected = (id: string) => selected !== null && id.split('#')[0] === selected.id;

  const uChainY = M.top + vMax * k + 24;
  const vChainX = 22;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="plate block w-full rounded-md bg-card" role="img" aria-label="רשת השרטוט">
      {/* grid lines and their names */}
      {U.map((u, i) => (
        <g key={`u${i}`}>
          <line x1={sx(u)} x2={sx(u)} y1={M.top - 6} y2={M.top + vMax * k + 6} className="stroke-line" strokeDasharray="4 4" />
          <text x={sx(u)} y={M.top - 12} textAnchor="middle" fontSize="11" className="fill-faint">
            {lineName(axes.u, i, grid)}
          </text>
        </g>
      ))}
      {V.map((v, j) => (
        <line key={`v${j}`} x1={M.left - 6} x2={M.left + uMax * k + 6} y1={sy(v)} y2={sy(v)} className="stroke-line" strokeDasharray="4 4" />
      ))}

      {/* members */}
      {inPlane.map(({ m, x1, y1, x2, y2, w }) => (
        <g key={m.id} onClick={() => onPick(pickOf(m.id))} className="cursor-pointer">
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(w, 18)} />
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={w}
            className={isSelected(m.id) ? 'stroke-accent' : m.label === 'מילוי' ? 'stroke-muted' : 'stroke-ink'}
            strokeOpacity={isSelected(m.id) ? 1 : 0.85}
          />
        </g>
      ))}
      {crossing.map(({ m, x, y, w, h }) => (
        <rect
          key={m.id}
          x={x - w / 2}
          y={y - h / 2}
          width={w}
          height={h}
          onClick={() => onPick(pickOf(m.id))}
          className={`cursor-pointer ${isSelected(m.id) ? 'fill-accent' : 'fill-ink'}`}
        />
      ))}

      {/* grid points */}
      {U.map((u, i) =>
        V.map((v, j) => {
          const n = nodeAt(i, j);
          const on = pending !== null && pending.join() === n.join();
          return (
            <g key={`n${i}-${j}`} onClick={() => onNode(n)} className="cursor-pointer">
              <circle cx={sx(u)} cy={sy(v)} r="22" fill="transparent" />
              <circle cx={sx(u)} cy={sy(v)} r={on ? 7 : 5} strokeWidth="1.5" className={on ? 'fill-accent stroke-accent' : 'fill-card stroke-muted'} />
            </g>
          );
        }),
      )}

      {/* measurements: tap to type a new one */}
      {grid[axes.u].map((s, i) => (
        <DimPill key={`du${i}`} x={(sx(U[i]) + sx(U[i + 1])) / 2} y={uChainY} x1={sx(U[i])} x2={sx(U[i + 1])} value={s} onTap={() => onDim(axes.u, i)} horizontal />
      ))}
      {grid[axes.v].map((s, j) => (
        <DimPill key={`dv${j}`} x={vChainX} y={(sy(V[j]) + sy(V[j + 1])) / 2} x1={sy(V[j])} x2={sy(V[j + 1])} value={s} onTap={() => onDim(axes.v, j)} />
      ))}
    </svg>
  );
}

function DimPill({ x, y, x1, x2, value, onTap, horizontal = false }: { x: number; y: number; x1: number; x2: number; value: number; onTap: () => void; horizontal?: boolean }) {
  const label = fmtNum(value);
  const w = Math.max(30, label.length * 6.6 + 10);
  return (
    <g onClick={onTap} className="cursor-pointer">
      {horizontal ? (
        <line x1={x1} x2={x2} y1={y} y2={y} className="stroke-faint" strokeWidth="1" />
      ) : (
        <line x1={x + 18} x2={x + 18} y1={x1} y2={x2} className="stroke-faint" strokeWidth="1" />
      )}
      <rect x={x - w / 2} y={y - 10} width={w} height="20" rx="10" className="fill-card stroke-accent" strokeWidth="1.2" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="600" className="fill-accent">
        {label}
      </text>
    </g>
  );
}

// ------------------------------------------------------------------------------------------- sheets

function NumberEditor({ value, onDone }: { value: number; onDone: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const num = Number(text.replace(/,/g, ''));
  const ok = Number.isFinite(num) && num > 0 && num <= 60_000;
  const bump = (d: number) => setText(String(Math.max(1, Math.round((ok ? num : value) + d))));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onDone(num);
      }}
      className="space-y-3"
    >
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => bump(-10)} dir="ltr" className="btn-secondary h-12 w-14 shrink-0 text-lg" aria-label="פחות 10">
          −10
        </button>
        <input
          className="field tnum h-12 flex-1 text-center text-xl font-semibold"
          inputMode="decimal"
          dir="ltr"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="מידה במ״מ"
          autoFocus
        />
        <button type="button" onClick={() => bump(10)} dir="ltr" className="btn-secondary h-12 w-14 shrink-0 text-lg" aria-label="עוד 10">
          +10
        </button>
      </div>
      <p className="text-center text-[0.85rem] text-muted">מ״מ, מקו לקו</p>
      <button type="submit" disabled={!ok} className="btn-primary disabled:opacity-50">
        עדכן
      </button>
    </form>
  );
}

function GridEditor({ design, onChange }: { design: Design; onChange: (d: Design) => void }) {
  return (
    <div className="space-y-5">
      {(['x', 'y', 'z'] as GridAxis[]).map((axis) => (
        <section key={axis}>
          <h3 className="mb-1.5 font-semibold">
            {AXIS_LABELS[axis]}
            <span className="font-normal text-muted"> ({axis === 'y' ? 'מהקרקע למעלה' : axis === 'x' ? 'משמאל לימין' : 'מאחור קדימה'})</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {design.grid[axis].map((s, i) => (
              <SpacingInput key={`${axis}${i}-${s}`} value={s} onCommit={(v) => onChange(setSpacing(design, axis, i, v))} />
            ))}
            <button type="button" onClick={() => onChange(addBay(design, axis))} className="btn-secondary h-11 px-3 text-[0.9rem]" aria-label={`הוסף שדה ל${AXIS_LABELS[axis]}`}>
              <Icon name="plus" size={18} />
            </button>
            {(axis === 'z' ? design.grid.z.length > 0 : design.grid[axis].length > 1) && (
              <button
                type="button"
                onClick={() => {
                  const { design: next, removed } = removeLastBay(design, axis);
                  onChange(next);
                  if (removed) toast(`הוסרו ${removed} חלקים שעמדו על הקו האחרון`);
                }}
                className="btn-secondary h-11 px-3 text-[0.9rem]"
                aria-label={`הסר את השדה האחרון מ${AXIS_LABELS[axis]}`}
              >
                <Icon name="trash" size={18} />
              </button>
            )}
          </div>
        </section>
      ))}
      <p className="text-[0.85rem] text-muted">כל מספר הוא מרחק בין שני קווים, במ״מ.</p>
    </div>
  );
}

function SpacingInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      className="field tnum h-11 w-24 text-center"
      inputMode="decimal"
      dir="ltr"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      aria-label="מרחק במ״מ"
    />
  );
}

export function ProfilePicker({ value, onChange }: { value: ProfileChoice; onChange: (c: ProfileChoice) => void }) {
  const [profile, setProfile] = useState<Profile>(value.profile);
  const [text, setText] = useState(value.profile === profile ? sizeText(value.size) : '');
  const typed = parseSize(profile, text);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {PROFILES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setProfile(p);
              setText('');
            }}
            aria-pressed={profile === p}
            className={`min-h-10 rounded-md border px-3 text-[0.9rem] font-semibold ${profile === p ? 'border-ink bg-ink text-white' : 'border-line-strong bg-card'}`}
          >
            {PROFILE_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {COMMON_SIZES[profile].map((size) => (
          <button
            key={size.join()}
            type="button"
            onClick={() => onChange({ profile, size })}
            className={`tnum min-h-10 rounded-md border px-2.5 text-[0.9rem] ${
              value.profile === profile && sizeText(value.size) === sizeText(size) ? 'border-accent bg-accent-soft font-semibold' : 'border-line-strong bg-card'
            }`}
          >
            {sizeText(size)}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="field tnum flex-1"
          dir="ltr"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={profile === 'rect_tube' ? '60/40/2' : profile === 'flat' ? '40/5' : profile === 'round_tube' ? '48.3/2.9' : '20'}
          aria-label="מידה אחרת"
        />
        <button type="button" disabled={!typed} onClick={() => typed && onChange({ profile, size: typed })} className="btn-secondary px-4 disabled:opacity-40">
          בחר
        </button>
      </div>
    </div>
  );
}

function MemberEditor({ design, id, length, onChange, onClose }: { design: Design; id: string; length: number; onChange: (d: Design) => void; onClose: () => void }) {
  const m = design.members.find((x) => x.id === id);
  const [label, setLabel] = useState(m?.label ?? '');
  const [fillWith, setFillWith] = useState<string>('');
  if (!m) return null;
  const vertical = m.a[0] === m.b[0] && m.a[2] === m.b[2];
  const onGround = vertical && Math.min(m.a[1], m.b[1]) === 0;
  // Infill partners: other members parallel to this one (same direction, different line)
  const dir = (n: typeof m) => [n.b[0] - n.a[0], n.b[1] - n.a[1], n.b[2] - n.a[2]].map(Math.sign).map(Math.abs).join();
  const partners = design.members.filter((o) => o.id !== m.id && dir(o) === dir(m));
  const describe = (o: typeof m) =>
    `${o.label ? `${o.label}, ` : ''}${xLineName(o.a[0])}${o.a[2] + 1}–${xLineName(o.b[0])}${o.b[2] + 1}, גובה ${fmtNum(gridLines(design.grid.y).at(Math.min(o.a[1], o.b[1])) ?? 0)}`;

  return (
    <div className="space-y-4">
      <p className="tnum text-muted">אורך חיתוך {fmtNum(length)} מ״מ</p>
      <label className="block">
        <span className="mb-1 block text-[0.85rem] text-muted">שם (לא חובה)</span>
        <input
          className="field"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== (m.label ?? '') && onChange(updateMember(design, id, { label: label.trim() || undefined }))}
          placeholder="עמוד, קורה, משקוף..."
        />
      </label>
      <section>
        <h3 className="mb-1.5 text-[0.9rem] font-semibold">פרופיל</h3>
        <ProfilePicker value={{ profile: m.profile, size: m.size }} onChange={(c) => onChange(updateMember(design, id, { profile: c.profile, size: c.size }))} />
      </section>
      {onGround && (
        <section className="rounded-md border border-line p-3">
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span className="font-semibold">פלטת בסיס</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--color-accent)]"
              checked={Boolean(m.base)}
              onChange={(e) => onChange(updateMember(design, id, { base: e.target.checked ? { w: 200, d: 200, t: 10 } : null }))}
            />
          </label>
          {m.base && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['w', 'd', 't'] as const).map((key) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-[0.8rem] text-muted">{key === 'w' ? 'רוחב' : key === 'd' ? 'עומק' : 'עובי'}</span>
                  <SpacingInput value={(m.base as NonNullable<typeof m.base>)[key]} onCommit={(v) => onChange(updateMember(design, id, { base: { ...(m.base as NonNullable<typeof m.base>), [key]: v } }))} />
                </label>
              ))}
            </div>
          )}
        </section>
      )}
      {partners.length > 0 && (
        <section className="rounded-md border border-line p-3">
          <h3 className="text-[0.9rem] font-semibold">מילוי בין החלק הזה לחלק מקביל</h3>
          <select className="field mt-2" value={fillWith} onChange={(e) => setFillWith(e.target.value)} aria-label="החלק השני">
            <option value="">בחר חלק מקביל...</option>
            {partners.map((o) => (
              <option key={o.id} value={o.id}>
                {describe(o)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!fillWith}
            onClick={() => {
              onChange(addInfill(design, [id, fillWith], { profile: 'square_bar', size: [16] }, 100).design);
              onClose();
              toast('נוסף מילוי. גע בו כדי לשנות פרופיל ומרווח');
            }}
            className="btn-secondary mt-2 w-full disabled:opacity-40"
          >
            הוסף מילוי
          </button>
        </section>
      )}
      <button
        type="button"
        onClick={() => {
          onChange(removeMember(design, id));
          onClose();
        }}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-danger font-semibold text-danger"
      >
        <Icon name="trash" size={18} />
        מחק חלק
      </button>
    </div>
  );
}

function InfillEditor({ design, id, onChange, onClose }: { design: Design; id: string; onChange: (d: Design) => void; onClose: () => void }) {
  const f = design.infills.find((x) => x.id === id);
  if (!f) return null;
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[0.85rem] text-muted">מרווח מקסימלי בין המוטות, מ״מ</span>
        <SpacingInput value={f.gap} onCommit={(v) => onChange(updateInfill(design, id, { gap: v }))} />
      </label>
      <section>
        <h3 className="mb-1.5 text-[0.9rem] font-semibold">פרופיל המילוי</h3>
        <ProfilePicker value={{ profile: f.profile, size: f.size }} onChange={(c) => onChange(updateInfill(design, id, { profile: c.profile, size: c.size }))} />
      </section>
      <button
        type="button"
        onClick={() => {
          onChange(removeInfill(design, id));
          onClose();
        }}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-danger font-semibold text-danger"
      >
        <Icon name="trash" size={18} />
        מחק מילוי
      </button>
    </div>
  );
}
