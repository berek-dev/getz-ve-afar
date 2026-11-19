/** A 3D model being built (or just built) for a job Yaal isn't looking at: one line at the top, tap to open it. */
import { useModelRuns, useTicker } from '../lib/modelRuns.ts';
import { Icon } from './Icon.tsx';

export function RunsBar({ jobId, step }: { jobId: number | null; step: string | null }) {
  const runs = useModelRuns().filter((r) => !(r.jobId === jobId && step === 'model'));
  const now = useTicker(runs.some((r) => r.status === 'running'));
  if (runs.length === 0) return null;
  return (
    <div className="mb-4 space-y-2" role="status">
      {runs.map((r) => {
        const s = Math.max(0, Math.round((now - r.startedAt) / 1000));
        return (
          <a
            key={r.jobId}
            href={`#/jobs/${r.jobId}/model`}
            className={`plate flex min-h-12 items-center gap-2.5 rounded-md px-3 py-2 text-[0.9rem] active:bg-sunken ${
              r.status === 'done' ? 'border-ok' : r.status === 'failed' ? 'border-danger' : ''
            }`}
          >
            {r.status === 'running' ? (
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Icon name={r.status === 'done' ? 'check' : 'close'} size={18} className={`shrink-0 ${r.status === 'done' ? 'text-ok' : 'text-danger'}`} />
            )}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{r.status === 'running' ? 'בונה הדמיה' : r.status === 'done' ? 'ההדמיה מוכנה' : 'ההדמיה לא נבנתה'}</span>
              <span className="text-muted">: {r.title}</span>
            </span>
            {r.status === 'running' ? (
              <span className="tnum shrink-0 text-muted">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
            ) : (
              <span className="shrink-0 font-semibold text-accent">לצפייה</span>
            )}
          </a>
        );
      })}
    </div>
  );
}
