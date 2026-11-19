import { api } from '../lib/api.ts';
import { JobForm } from '../components/JobForm.tsx';
import { PageHeader } from '../components/ui.tsx';
import { toast } from '../components/Toast.tsx';

/** ＋ in the bottom bar: a new request from a client (who, where, what), then straight into the job. */
export function NewJobPage() {
  return (
    <div>
      <PageHeader title="פנייה חדשה">
        <p className="mt-0.5 text-[0.95rem] text-muted">מספיק שם ומה צריך. את השאר משלימים בהמשך.</p>
      </PageHeader>
      <JobForm
        submitLabel="שמור ופתח את העבודה"
        offerTemplates
        onSubmit={async (draft) => {
          const job = await api.createJob(draft);
          toast('הפנייה נשמרה');
          window.location.hash = `#/jobs/${job.id}`;
        }}
      />
    </div>
  );
}
