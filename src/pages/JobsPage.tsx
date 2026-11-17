import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { NewJob } from '../lib/api.ts';
import { JOB_KIND_LABELS, JOB_STATUS_LABELS } from '../core/types.ts';
import type { Job, JobKind, JobStatus } from '../core/types.ts';

const STATUS_COLORS: Record<JobStatus, string> = {
  lead: 'bg-sky-100 text-sky-800',
  visit: 'bg-violet-100 text-violet-800',
  quoted: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  in_progress: 'bg-ember-100 text-ember-700',
  done: 'bg-stone-200 text-stone-700',
  paid: 'bg-green-200 text-green-900',
  lost: 'bg-stone-100 text-stone-400',
};

export function JobsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    api
      .jobs()
      .then((j) => {
        setJobs(j);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(load, [load]);

  const changeStatus = async (job: Job, status: JobStatus) => {
    try {
      const updated = await api.setJobStatus(job.id, status);
      setJobs((prev) => prev?.map((j) => (j.id === job.id ? { ...j, ...updated } : j)) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-extrabold">עבודות</h2>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="rounded-xl bg-ember-500 px-4 py-2 font-bold text-white active:bg-ember-600"
        >
          {showForm ? 'סגור' : '+ עבודה חדשה'}
        </button>
      </div>

      {showForm && (
        <NewJobForm
          onCreated={(job) => {
            setJobs((prev) => [job, ...(prev ?? [])]);
            setShowForm(false);
          }}
        />
      )}

      {error && <p className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}

      {jobs === null && !error && <p className="text-stone-500">טוען...</p>}

      {jobs?.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-stone-300 p-8 text-center text-stone-500">
          עוד אין עבודות. לחץ על "עבודה חדשה" כדי להתחיל.
        </div>
      )}

      <ul className="space-y-3">
        {jobs?.map((job) => (
          <li key={job.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-bold">{job.title}</p>
                <p className="text-sm text-stone-500">
                  {job.client_name ?? 'ללא לקוח'} · {JOB_KIND_LABELS[job.kind]}
                </p>
                {job.site_address && <p className="text-sm text-stone-500">{job.site_address}</p>}
              </div>
              <select
                value={job.status}
                onChange={(e) => changeStatus(job, e.target.value as JobStatus)}
                className={`rounded-full px-2 py-1 text-sm font-medium ${STATUS_COLORS[job.status]}`}
                aria-label="סטטוס"
              >
                {Object.entries(JOB_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewJobForm({ onCreated }: { onCreated: (job: Job) => void }) {
  const [form, setForm] = useState<NewJob>({ title: '', kind: 'fabrication' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof NewJob>(key: K, value: NewJob[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      onCreated(await api.createJob(form));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full rounded-xl border border-stone-300 bg-white px-3 py-2 focus:border-ember-500 focus:outline-none';

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">מה העבודה? *</span>
        <input
          className={input}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="למשל: שער כנף כפולה 4 מ'"
          required
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">לקוח</span>
        <input className={input} value={form.client_name ?? ''} onChange={(e) => set('client_name', e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">סוג עבודה</span>
        <select className={input} value={form.kind} onChange={(e) => set('kind', e.target.value as JobKind)}>
          {Object.entries(JOB_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">כתובת האתר</span>
        <input className={input} value={form.site_address ?? ''} onChange={(e) => set('site_address', e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">תיאור (אפשר להכתיב במיקרופון של המקלדת)</span>
        <textarea
          className={`${input} min-h-24`}
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl bg-stone-900 py-3 font-bold text-white disabled:opacity-50"
      >
        {saving ? 'שומר...' : 'שמור עבודה'}
      </button>
    </form>
  );
}
