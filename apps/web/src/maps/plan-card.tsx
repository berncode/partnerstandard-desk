// One MAP on the Plans page. Named "Acme as reseller", with the partner type's stage from Partners, and links to /plans/{mapId}.
import type { IsoDate } from '@partner-desk/core';
import { STAGE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { cn } from '@/ui/cn';
import { HealthBadge, NotSignedBadge } from './badges';
import { formatMapDate, relativeDay } from './format';
import type { PlanCard } from './view-model';

export const mapPath = (mapId: string) => `/plans/${mapId}`;

/**
 * The card's box model, shared with PendingCards so nothing moves when the sheets arrive. Every line has a fixed
 * height: the head fits the health badge (h-6), the stage line is one text-xs line, and each stat column leaves room
 * for a label, a value and the milestone's date (3.125rem).
 */
export const CARD = {
  frame: 'block min-w-0 rounded-xl border border-line bg-surface p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
  head: 'flex h-6 items-start gap-2',
  title: 'min-w-0 flex-1 truncate text-[15px] font-semibold',
  meta: 'mt-1 h-4 truncate text-xs',
  bar: 'mt-3 h-1 overflow-hidden rounded-full bg-surface-2',
  stats: 'mt-4 grid grid-cols-3 gap-3 text-xs',
  stat: 'min-h-[3.125rem] min-w-0',
} as const;

export function PlanCardView({ card, today }: { card: PlanCard; today: IsoDate }) {
  return (
    <Link href={mapPath(card.mapId)} data-slot="frame" className={cn(CARD.frame, 'group transition-colors hover:border-brand/50')}>
      <div data-slot="head" className={CARD.head}>
        <h2 data-slot="title" className={cn(CARD.title, 'group-hover:text-brand-strong')}>{card.displayName}</h2>
        {card.health === null ? <NotSignedBadge /> : <HealthBadge health={card.health} />}
      </div>
      <p data-slot="meta" className={cn(CARD.meta, 'text-ink-3')}>{STAGE_LABELS[card.stage]} · {card.progress.label}</p>
      <div data-slot="bar" className={CARD.bar}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(card.progress.ratio * 100)}%` }} />
      </div>
      <PlanStats card={card} today={today} />
    </Link>
  );
}

/** Next milestone, overdue activities and the last activity: the card's three numbers, also on the partner's MAP area. */
export function PlanStats({ card, today }: { card: PlanCard; today: IsoDate }) {
  return (
    <dl data-slot="stats" className={CARD.stats}>
      <div data-slot="stat" className={CARD.stat}>
        <dt className="text-ink-3">{COPY.MAP_NEXT_MILESTONE}</dt>
        <dd className="mt-0.5 truncate font-medium" title={card.nextMilestone?.name}>{card.nextMilestone?.name ?? COPY.MAP_NONE_SET}</dd>
        {card.nextMilestone?.targetDate && <dd className="text-ink-3">{formatMapDate(card.nextMilestone.targetDate, today)}</dd>}
      </div>
      <div data-slot="stat" className={CARD.stat}>
        <dt className="text-ink-3">{COPY.MAP_OVERDUE}</dt>
        <dd data-testid="overdue-count" className={cn('mt-0.5 font-medium', card.overdueCount > 0 && 'text-danger')}>{card.overdueCount}</dd>
      </div>
      <div data-slot="stat" className={CARD.stat}>
        <dt className="text-ink-3">{COPY.MAP_LAST_ACTIVITY}</dt>
        <dd className="mt-0.5 font-medium">{card.lastActivityAt ? relativeDay(card.lastActivityAt, today) : COPY.MAP_NONE_YET}</dd>
      </div>
    </dl>
  );
}
