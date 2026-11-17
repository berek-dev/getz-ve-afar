import type { CutBar, CutPlan } from '../core/quantities.ts';
import { fmtMeters, fmtNum, fmtPct } from '../lib/format.ts';

/** Identical bars (same pieces) are drawn once with "× n". */
function groupBars(bars: CutBar[]): { bar: CutBar; count: number }[] {
  const out: { bar: CutBar; count: number; key: string }[] = [];
  for (const bar of bars) {
    const key = bar.pieces.join(',');
    const existing = out.find((g) => g.key === key);
    if (existing) existing.count++;
    else out.push({ bar, count: 1, key });
  }
  return out;
}

export function CutPlanView({ plan }: { plan: CutPlan }) {
  return (
    <div className="plate rounded-[10px] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{plan.name}</p>
        <p className="tnum shrink-0 text-steel-300">
          {plan.bars.length} {plan.bars.length === 1 ? 'מוט' : 'מוטות'}
        </p>
      </div>
      <p className="tnum mt-0.5 text-sm text-steel-300">
        נכנס לעבודה {fmtMeters(plan.netLengthMm)} מתוך {fmtMeters(plan.boughtLengthMm)}, פחת {fmtPct(plan.waste)}
      </p>

      <ul className="mt-3 space-y-2">
        {groupBars(plan.bars).map(({ bar, count }, i) => (
          <li key={i} className="flex items-center gap-2">
            <BarStrip bar={bar} stock={plan.stockLengthMm} />
            <span className="tnum w-9 shrink-0 text-sm text-steel-300">{count > 1 ? `×${count}` : ''}</span>
          </li>
        ))}
      </ul>

      {plan.oversize.length > 0 && (
        <p className="mt-3 rounded-lg border border-primer p-2.5 text-sm text-primer-light" role="alert">
          {plan.oversize.length === 1
            ? `חתיכה של ${fmtNum(plan.oversize[0] ?? 0)} מ״מ ארוכה מהמוט`
            : `${plan.oversize.length} חתיכות (עד ${fmtNum(Math.max(...plan.oversize))} מ״מ) ארוכות מהמוט`}{' '}
          ({fmtMeters(plan.stockLengthMm)}). צריך מוט ארוך יותר או חיבור בריתוך. בינתיים הן מתומחרות לפי האורך שלהן.
        </p>
      )}
    </div>
  );
}

function BarStrip({ bar, stock }: { bar: CutBar; stock: number }) {
  const label = `${bar.pieces.map((p) => fmtNum(p)).join(' + ')} מ״מ, נשאר ${fmtNum(bar.offcut)} מ״מ`;
  return (
    <div
      className="relative flex h-9 flex-1 overflow-hidden rounded-[4px] border border-steel-700"
      role="img"
      aria-label={label}
      style={{
        // off-cut: hatched like a drawing's scrap area
        backgroundImage:
          'repeating-linear-gradient(-45deg, var(--color-steel-700) 0 2px, transparent 2px 7px)',
      }}
    >
      {bar.pieces.map((piece, i) => {
        const width = (piece / stock) * 100;
        return (
          <span
            key={i}
            className="tnum flex items-center justify-center border-e-2 border-steel-900 bg-steel-500 text-xs font-semibold text-steel-950"
            style={{ width: `${width}%` }}
          >
            {width > 13 ? fmtNum(piece) : ''}
          </span>
        );
      })}
    </div>
  );
}
