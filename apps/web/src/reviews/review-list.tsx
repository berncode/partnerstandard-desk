// New for PartnerStandard Desk (reviews spec 6): the Reviews page's list. Coming and overdue first, then prep started, then the
// ones later, then the held ones (newest first), then the MAPs that couldn't be read. Each line opens its review.
import type { ReviewLine } from '@partner-desk/commands';
import type { IsoDate } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { formatMapDate } from '@/maps/format';
import { mapPath } from '@/maps/plan-card';
import { reviewPath } from './review-model';

export interface ReviewGroups {
  coming: ReviewLine[];
  prep: ReviewLine[];
  later: ReviewLine[];
  held: ReviewLine[];
  unreadable: ReviewLine[];
}

/** The lines in their groups. `listReviews` sorts by date, soonest first; held ones are turned around here. */
export function groupReviews(lines: ReviewLine[]): ReviewGroups {
  const by = (keep: (l: ReviewLine) => boolean) => lines.filter((l) => !l.unreadable && keep(l));
  return {
    coming: by((l) => l.state === 'coming' || l.state === 'overdue'),
    prep: by((l) => l.state === 'prep'),
    later: by((l) => l.state === 'later'),
    held: by((l) => l.state === 'held').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.horizon - a.horizon),
    unreadable: lines.filter((l) => l.unreadable),
  };
}

function lineText(line: ReviewLine, today: IsoDate): string {
  const date = line.date ? formatMapDate(line.date, today) : '';
  if (line.state === 'overdue') return COPY.REVIEWS_OVERDUE_SINCE(date);
  if (line.state === 'held') return COPY.REVIEW_HELD_ON(date);
  return COPY.REVIEW_ON(date);
}

function Group({ title, lines, today }: { title: string; lines: ReviewLine[]; today: IsoDate }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label={title} className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-2 text-[15px] font-semibold tracking-tight">{title}</h2>
      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={`${l.mapId}-${l.reviewId ?? l.horizon}-${l.state}`}>
            <Link href={reviewPath(l.mapId, l.state === 'held' ? l.reviewId : null)}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded py-2.5 outline-none hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand">
              <span className="min-w-0 font-medium break-words">{l.displayName}</span>
              <span className="text-sm text-ink-3">{COPY.REVIEWS_HORIZON(l.horizon)} · {lineText(l, today)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Reviews page's lists; the empty sentence when there is no line at all. */
export function ReviewList({ lines, today }: { lines: ReviewLine[]; today: IsoDate }) {
  if (lines.length === 0) {
    return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-2">{COPY.REVIEWS_EMPTY}</p>;
  }
  const groups = groupReviews(lines);
  return (
    <div className="grid gap-4">
      <Group title={COPY.REVIEWS_COMING} lines={groups.coming} today={today} />
      <Group title={COPY.REVIEWS_PREP} lines={groups.prep} today={today} />
      <Group title={COPY.REVIEWS_LATER} lines={groups.later} today={today} />
      <Group title={COPY.REVIEWS_HELD} lines={groups.held} today={today} />
      {groups.unreadable.length > 0 && (
        <section aria-labelledby="review-problems" className="rounded-xl border border-warn/30 bg-warn-soft p-4 text-sm text-warn">
          <h2 id="review-problems" className="font-medium">{COPY.REVIEWS_PROBLEMS}</h2>
          <ul className="mt-2 space-y-2">
            {groups.unreadable.map((l) => (
              <li key={l.mapId} className="break-words">
                <Link href={mapPath(l.mapId)} className="font-medium underline">{l.displayName}</Link>: {COPY.REVIEWS_CANT_OPEN}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
