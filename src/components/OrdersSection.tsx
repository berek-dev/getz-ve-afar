import { useMemo } from 'react';
import type { JobDetail } from '../lib/api.ts';
import type { CutPlan } from '../core/quantities.ts';
import { buildOrders, orderMessage } from '../core/purchasing.ts';
import { formatIls } from '../core/money.ts';
import { whatsappLink } from '../core/phone.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

/** What to buy for the job, one card per supplier, ready to send on WhatsApp. */
export function OrdersSection({ job, cutPlans, businessName }: { job: JobDetail; cutPlans: CutPlan[]; businessName: string }) {
  const orders = useMemo(() => buildOrders(job.items, cutPlans), [job.items, cutPlans]);

  if (job.items.length === 0) {
    return <p className="mt-4 text-steel-300">רשימת הקניות נבנית מכתב הכמויות. קודם מוסיפים שורות.</p>;
  }
  if (orders.length === 0) {
    return <p className="mt-4 text-steel-300">אין בעבודה הזו חומרים לקנות, רק עבודה וציוד.</p>;
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-steel-300">
        הפרופילים מוזמנים במוטות שלמים לפי תוכנית החיתוך. כל ספק מקבל רק את מה שלו, בלי פרטי הלקוח.
      </p>
      {orders.map((order) => {
        const text = orderMessage(order, { businessName, jobTitle: job.title });
        return (
          <section key={order.supplierId ?? 'none'} className="plate rounded-[10px] p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Icon name="truck" size={20} className="text-steel-300" />
                {order.supplierName ?? 'בלי ספק קבוע'}
              </h3>
              <span className="tnum shrink-0 text-sm text-steel-300">בערך {formatIls(order.cost)}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {order.lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 border-b border-steel-700 pb-2 last:border-0 last:pb-0">
                  <span className="min-w-0">
                    {l.name}
                    {l.note && <span className="mt-0.5 block text-sm text-hivis">{l.note}</span>}
                  </span>
                  <span className="tnum shrink-0 font-semibold">{l.qty}</span>
                </li>
              ))}
            </ul>
            {order.supplierId === null && (
              <p className="mt-3 text-sm text-steel-300">
                כדי שפריטים יגיעו לספק הנכון, קבע ספק לכל פריט במחירון. בינתיים אפשר לשלוח את הרשימה לכל ספק.
              </p>
            )}
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
              <a href={whatsappLink(order.supplierPhone, text)} target="_blank" rel="noreferrer" className="btn-primary">
                <Icon name="whatsapp" />
                {order.supplierPhone ? `שלח הזמנה ל${order.supplierName}` : 'שלח הזמנה בוואטסאפ'}
              </a>
              <button
                type="button"
                aria-label="העתק את ההזמנה"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(text)
                    .then(() => toast('ההזמנה הועתקה'))
                    .catch(() => toast('לא הצלחתי להעתיק'));
                }}
                className="grid min-h-12 w-12 place-items-center rounded-xl border border-steel-500"
              >
                <Icon name="copy" size={20} />
              </button>
            </div>
          </section>
        );
      })}
      <p className="text-sm text-steel-500">המחירים לפי המחירון שלך, לפני מע״מ. הספק יאשר מחיר סופי.</p>
    </div>
  );
}
