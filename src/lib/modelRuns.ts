/**
 * 3D models being built by Gemini, kept outside the screens: Yaal can leave the model step (schedule a visit,
 * update another job) while the request runs, and a bar at the top of the app shows it until he comes back.
 * If the phone drops the request (app in the background), the server keeps going for a while and this store
 * polls the job's model until the run is done.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, api, errorMessage } from './api.ts';
import type { JobModel, ModelRun } from './api.ts';
import { toast } from '../components/Toast.tsx';

export interface RunView {
  jobId: number;
  title: string;
  status: 'running' | 'done' | 'failed';
  /** ms since epoch */
  startedAt: number;
  mode: 'new' | 'edit';
  request: string;
  /** Hebrew, ready to show */
  error?: string;
  result?: JobModel;
}

const runs = new Map<number, RunView>();
const controllers = new Map<number, AbortController>();
const polls = new Map<number, ReturnType<typeof setInterval>>();
const listeners = new Set<() => void>();
let snapshot: RunView[] = [];

/** Give up polling after this long (the server marks a run cut off after 6 minutes) */
const GIVE_UP_MS = 7 * 60_000;

function emit() {
  snapshot = [...runs.values()];
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useModelRuns(): RunView[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function useModelRun(jobId: number): RunView | undefined {
  return useModelRuns().find((r) => r.jobId === jobId);
}

/** Re-renders every second while `on` (for the "34 שנ׳" counters) */
export function useTicker(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** D1's datetime('now') ("2026-11-19 07:30:00", UTC) → ms */
const serverTime = (t: string) => Date.parse(`${t.replace(' ', 'T')}Z`) || 0;

const onModelScreen = (jobId: number) => location.hash === `#/jobs/${jobId}/model`;

function stopPolling(jobId: number) {
  const t = polls.get(jobId);
  if (t) clearInterval(t);
  polls.delete(jobId);
}

function finish(jobId: number, patch: Pick<RunView, 'status'> & Partial<RunView>) {
  const run = runs.get(jobId);
  stopPolling(jobId);
  controllers.delete(jobId);
  if (!run) return;
  runs.set(jobId, { ...run, ...patch });
  emit();
  // The model screen shows the result itself; anywhere else a toast says it's ready
  if (!onModelScreen(jobId)) {
    toast(patch.status === 'done' ? `ההדמיה של "${run.title}" מוכנה` : `ההדמיה של "${run.title}" לא נבנתה`);
  }
}

function fail(jobId: number, code: string) {
  finish(jobId, { status: 'failed', error: errorMessage(new ApiError(502, code)) });
}

/** Ask the server every few seconds how the job's latest run went */
function poll(jobId: number) {
  if (polls.has(jobId)) return;
  const check = () => {
    const run = runs.get(jobId);
    if (!run) return stopPolling(jobId);
    api.model(jobId).then(
      (m) => {
        // Only a run that started with this one counts (an older run's result is not this request's)
        const r = m.run && serverTime(m.run.created_at) >= run.startedAt - 90_000 ? m.run : null;
        if (!r) {
          if (Date.now() - run.startedAt < 30_000) return; // the request may not have reached the server yet
          return fail(jobId, 'run_interrupted');
        }
        if (r.status === 'running') return;
        if (r.status === 'done') return finish(jobId, { status: 'done', result: m });
        if (r.status === 'canceled') {
          stopPolling(jobId);
          runs.delete(jobId);
          return emit();
        }
        fail(jobId, r.error ?? 'run_interrupted');
      },
      () => {
        // offline for now: keep trying until it's clearly over
        if (Date.now() - run.startedAt > GIVE_UP_MS) fail(jobId, 'run_interrupted');
      },
    );
  };
  polls.set(jobId, setInterval(check, 4000));
  check();
}

export function startModelRun(
  job: { id: number; title: string },
  body: { request: string; mode: 'new' | 'edit'; image?: { mime: string; data: string } | null },
): void {
  if (runs.get(job.id)?.status === 'running') return;
  const ctl = new AbortController();
  controllers.set(job.id, ctl);
  runs.set(job.id, { jobId: job.id, title: job.title, status: 'running', startedAt: Date.now(), mode: body.mode, request: body.request });
  emit();
  api.aiModel(job.id, body, ctl.signal).then(
    (m) => finish(job.id, { status: 'done', result: m }),
    (e: unknown) => {
      if ((e as { name?: string }).name === 'AbortError') return; // stopped from the app
      if (e instanceof ApiError) {
        if (e.message === 'run_in_progress') return poll(job.id);
        if (e.message === 'canceled') return;
        // 5xx without a JSON body = the connection, not Gemini: the server may still finish
        if (e.message !== 'bad_response') return fail(job.id, e.message);
      }
      poll(job.id); // the connection dropped (phone asleep, app in the background): the server may still finish
    },
  );
}

/** A run the server reports (the app was reloaded or reopened mid-run) */
export function followServerRun(job: { id: number; title: string }, run: ModelRun): void {
  if (runs.has(job.id) || run.status !== 'running') return;
  runs.set(job.id, {
    jobId: job.id,
    title: job.title,
    status: 'running',
    startedAt: serverTime(run.created_at) || Date.now(),
    mode: run.mode,
    request: run.request,
  });
  emit();
  poll(job.id);
}

/** "עצור": stop waiting; the server won't replace the model with this run's result. */
export function stopModelRun(jobId: number): void {
  controllers.get(jobId)?.abort();
  controllers.delete(jobId);
  stopPolling(jobId);
  runs.delete(jobId);
  emit();
  void api.cancelModel(jobId).catch(() => undefined);
}

/** The model screen took the result (or showed the error) */
export function dismissModelRun(jobId: number): void {
  if (runs.get(jobId)?.status === 'running') return;
  runs.delete(jobId);
  emit();
}

/** The job was deleted: drop its run (no bar, no "ready" toast) and its typed draft */
export function forgetJob(jobId: number): void {
  controllers.get(jobId)?.abort();
  controllers.delete(jobId);
  stopPolling(jobId);
  drafts.delete(jobId);
  try {
    localStorage.removeItem(draftKey(jobId));
  } catch {
    // ignore
  }
  if (runs.delete(jobId)) emit();
}

// ------------------------------------------------------------------------------------- drafts

/** What was typed (and the photo picked) for a job's model, kept while moving around the app */
export interface ModelDraft {
  text: string;
  startNew: boolean;
  image: { name: string; blob: Blob } | null;
}

const drafts = new Map<number, ModelDraft>();
const draftKey = (jobId: number) => `gva:model-draft:${jobId}`;

export function getDraft(jobId: number): ModelDraft {
  const d = drafts.get(jobId);
  if (d) return d;
  let text = '';
  try {
    text = localStorage.getItem(draftKey(jobId)) ?? '';
  } catch {
    // storage blocked: the draft lives in memory only
  }
  return { text, startNew: false, image: null };
}

export function saveDraft(jobId: number, d: ModelDraft): void {
  drafts.set(jobId, d);
  try {
    if (d.text.trim()) localStorage.setItem(draftKey(jobId), d.text);
    else localStorage.removeItem(draftKey(jobId));
  } catch {
    // ignore
  }
}
