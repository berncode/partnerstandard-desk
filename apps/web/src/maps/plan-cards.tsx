// The Plans page's cards, and the same boxes while the sheets load.
import type { IsoDate } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { DeleteMap, type DeleteMapAction } from './delete-map';
import { CARD, mapPath, PlanCardView } from './plan-card';
import type { PlanCard } from './view-model';

const GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';
const pulse = 'skeleton rounded';

/** The MAPs as cards, in the order given (sortByAttention). */
export function PlanCards({ cards, today }: { cards: PlanCard[]; today: IsoDate }) {
  return (
    <ul aria-label={COPY.PLANS_LIST} className={GRID}>
      {cards.map((card) => <li key={card.mapId} className="min-w-0"><PlanCardView card={card} today={today} /></li>)}
    </ul>
  );
}

/** The MAPs' names from the directory, shown at once while their sheets load. Same box as PlanCardView. */
export function PendingCards({ names }: { names: Array<{ mapId: string; displayName: string }> }) {
  return (
    <ul aria-label={COPY.PLANS_LOADING} aria-busy="true" className={GRID}>
      {names.map(({ mapId, displayName }) => (
        <li key={mapId} className="min-w-0">
          <Link href={mapPath(mapId)} data-slot="frame" className={CARD.frame}>
            <div data-slot="head" className={CARD.head}>
              <h2 data-slot="title" className={CARD.title}>{displayName}</h2>
              <div aria-hidden className="skeleton h-6 w-16 shrink-0 rounded-full" />
            </div>
            <div data-slot="meta" aria-hidden className={CARD.meta}><div className={`h-full w-28 ${pulse}`} /></div>
            <div data-slot="bar" aria-hidden className={CARD.bar} />
            <div data-slot="stats" aria-hidden className={CARD.stats}>
              {[0, 1, 2].map((i) => (
                <div key={i} data-slot="stat" className={CARD.stat}>
                  <div className={`h-4 w-16 ${pulse}`} />
                  <div className={`mt-0.5 h-4 w-10 ${pulse}`} />
                </div>
              ))}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface PlanProblem {
  mapId: string;
  displayName: string;
  message: string;
  /** Offered Delete (`mayDeleteAfter`): not when Google's sign-in is what broke. */
  deletable?: boolean;
}

/** MAPs whose sheets couldn't be read: each by name, with why, and with `remove`, Delete (spec 8). */
export function PlanProblems({ problems, remove }: { problems: PlanProblem[]; remove?: DeleteMapAction }) {
  if (problems.length === 0) return null;
  return (
    <section aria-labelledby="plan-problems" className="rounded-xl border border-warn/30 bg-warn-soft p-4 text-sm text-warn">
      <h2 id="plan-problems" className="font-medium">{COPY.PLANS_PROBLEMS}</h2>
      <ul className="mt-2 space-y-2">
        {problems.map((p) => (
          <li key={p.mapId} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="min-w-0 flex-1 basis-56 break-words">
              <Link href={mapPath(p.mapId)} className="font-medium underline">{p.displayName}</Link>: {p.message}
            </p>
            {remove && p.deletable && <DeleteMap mapId={p.mapId} name={p.displayName} remove={remove} named size="sm" />}
          </li>
        ))}
      </ul>
    </section>
  );
}
