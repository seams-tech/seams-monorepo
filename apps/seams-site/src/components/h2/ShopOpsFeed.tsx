import React from 'react';
import {
  CakeSlice,
  Coffee,
  Croissant,
  Fingerprint,
  ShoppingBag,
  Tag,
  Truck,
  Wheat,
} from 'lucide-react';

/* The front page hero's live card: a bakery-café with an online shop, run by
   agents. Tasks arrive at the top, show "Running" for a beat, and land on
   their result; a payment over the owner's limit is held for a passkey. It
   shows the store and café automation the platform sells. */

type TaskTone = 'done' | 'queued' | 'held';

type ShopTask = {
  icon: React.ComponentType<{ 'aria-hidden'?: boolean }>;
  task: string;
  detail: string;
  result: string;
  tone: TaskTone;
};

const shopTasks: readonly ShopTask[] = [
  {
    icon: Croissant,
    task: 'Bake plan: 120 croissants',
    detail: 'Prep agent · preorders and rain forecast',
    result: 'Planned',
    tone: 'done',
  },
  {
    icon: ShoppingBag,
    task: 'Online order #2391 · pickup 8:30',
    detail: 'Shop agent · paid on Shopify',
    result: 'Queued',
    tone: 'queued',
  },
  {
    icon: Wheat,
    task: 'Reorder flour 25 kg',
    detail: 'Stock agent · under 2 days left',
    result: 'Ordered',
    tone: 'done',
  },
  {
    icon: Truck,
    task: 'Pay dairy supplier ¥86,000',
    detail: 'Ops agent · over ¥50,000 needs the owner',
    result: 'Held',
    tone: 'held',
  },
  {
    icon: Tag,
    task: 'Day-old bread 30% off',
    detail: 'Pricing agent · from 18:00, waste rule',
    result: 'Scheduled',
    tone: 'queued',
  },
  {
    icon: Coffee,
    task: 'Oat milk low at Café 2',
    detail: 'Stock agent · added to morning delivery',
    result: 'Restocked',
    tone: 'done',
  },
  {
    icon: CakeSlice,
    task: 'Birthday cake · Sat 14:00',
    detail: 'Shop agent · deposit taken online',
    result: 'Booked',
    tone: 'done',
  },
];

const toneChip: Record<TaskTone, string> = {
  done: 'h2-chip--green',
  queued: 'h2-chip--plain',
  held: 'h2-chip--amber',
};

/* the CSS clips the list to this many rows (fewer on phones) */
const VISIBLE_ROWS = 4;
const TICK_MS = 2800;

function useFeedTick(): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return tick;
}

export function ShopOpsFeed(): React.JSX.Element {
  const tick = useFeedTick();
  const count = shopTasks.length;
  /* the newest task sits on top. One extra row renders under the clipped
     list: each tick remounts the list a step up and slides it down, so the
     new row enters at the top and the oldest one leaves at the bottom */
  const rows = Array.from({ length: VISIBLE_ROWS + 1 }, (_, i) => {
    const arrival = tick + VISIBLE_ROWS - i;
    return { arrival, item: shopTasks[arrival % count] };
  });

  return (
    <div
      className="h2-ops"
      role="img"
      aria-label="Live feed of a bakery-café run by agents: bake plans, online orders, stock reorders and markdowns, with a large supplier payment held for the owner"
    >
      <div className="h2-ops__head">
        <span className="h2-ops__title">
          <span className="h2-ops__live" aria-hidden />
          Kanda Bakery &amp; Café
        </span>
        <span className="h2-ops__count">46 tasks today</span>
      </div>
      <div className="h2-ops__window">
        <ul key={tick} className={`h2-ops__list${tick > 0 ? ' is-moving' : ''}`} aria-hidden>
          {rows.map(({ arrival, item }, i) => {
            const fresh = i === 0 && tick > 0;
            return (
              <li key={arrival} className={`h2-ops__row${fresh ? ' is-new' : ''}`}>
                <span className="h2-ops__icon">
                  <item.icon aria-hidden />
                </span>
                <span className="h2-ops__main">
                  <span className="h2-ops__task">{item.task}</span>
                  <small>{item.detail}</small>
                </span>
                <span className="h2-ops__result">
                  {fresh ? (
                    <span className="h2-chip h2-chip--plain h2-ops__running">Running</span>
                  ) : null}
                  <span className={`h2-chip ${toneChip[item.tone]} h2-ops__status`}>
                    {item.result}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="h2-ops__foot">
        <Fingerprint aria-hidden />
        Spends over your limits wait for your passkey
      </div>
    </div>
  );
}
