import { STAGE_ORDER, stageIndex } from '../core/stages.ts';
import type { JobStatus } from '../core/types.ts';

/** Heat-tint colours, one per stage: the job "heats up" from first call (straw) to paid (blue). */
export const HEAT_COLORS = [
  'var(--color-heat-1)',
  'var(--color-heat-2)',
  'var(--color-heat-3)',
  'var(--color-heat-4)',
  'var(--color-heat-5)',
  'var(--color-heat-6)',
  'var(--color-heat-7)',
];

export function stageColor(status: JobStatus): string {
  const i = stageIndex(status);
  return i < 0 ? 'var(--color-primer-light)' : (HEAT_COLORS[i] ?? 'var(--color-soapstone)');
}

export function StageBar({ status }: { status: JobStatus }) {
  const current = stageIndex(status);
  const lost = current < 0;
  return (
    <span className="flex gap-1" aria-hidden="true">
      {STAGE_ORDER.map((s, i) => (
        <span
          key={s}
          className="h-2.5 flex-1 rounded-[2px] transition-colors duration-300"
          style={{
            background: lost
              ? 'var(--color-primer)'
              : i <= current
                ? HEAT_COLORS[i]
                : 'var(--color-steel-700)',
            opacity: lost ? 0.45 : 1,
          }}
        />
      ))}
    </span>
  );
}
