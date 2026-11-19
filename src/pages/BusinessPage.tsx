import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { PageHeader } from '../components/ui.tsx';

const ROWS: { href: string; icon: IconName; title: string; text: string }[] = [
  { href: '#/money', icon: 'wallet', title: 'כספים', text: 'הכנסות והוצאות של החודש, יתרות פתוחות, דוח לרואה החשבון' },
  { href: '#/prices', icon: 'tag', title: 'מחירון וחומרים', text: 'פרופילים, פרזול וצבע, מחיר לק״ג לכל חומר, ספקים' },
  { href: '#/pricing', icon: 'gauge', title: 'הגדרות', text: 'שעת עבודה, תקורה ורווח, מע״מ, פרטי העסק ותנאי ההצעה' },
];

/** The business side, away from day-to-day jobs. */
export function BusinessPage() {
  return (
    <div>
      <PageHeader title="עסק" />
      <ul className="plate divide-y divide-line rounded-md">
        {ROWS.map((r) => (
          <li key={r.href}>
            <a href={r.href} className="flex min-h-16 items-center gap-3.5 px-4 py-3 active:bg-sunken">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-line text-ink">
                <Icon name={r.icon} size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.title}</span>
                <span className="block text-[0.85rem] leading-snug text-muted">{r.text}</span>
              </span>
              <Icon name="forward" size={18} className="shrink-0 text-faint" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
