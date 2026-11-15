import { ownerTimeZone, ownerToday, type Deps } from '@partner-desk/commands';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { mapChange } from '@/app/(signed-in)/actions/maps';
import { reviewClose, reviewOpen, reviewSummaryRevoke, reviewSummarySend } from '@/app/(signed-in)/actions/reviews';
import { mapPath } from '@/maps/plan-card';
import { LoadProblem } from '@/markets/load-problem';
import { loadReview } from './review-loader';
import { reviewPath } from './review-model';
import { ReviewPage } from './review-page';
import { actorFor, companyFor, type OwnerSession } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';

/**
 * The review page's server part (reviews spec 5.2): the current horizon's review, or a held one with `reviewId`, read
 * through the commands for the signed-in owner only (the route's loader asks `requireOwner`). A person with a link, or a
 * review that isn't there, is not found.
 */
export async function ReviewScreen({ mapId, reviewId, session, deps }: {
  mapId: string; reviewId?: string; session: OwnerSession; deps: Deps;
}) {
  const here = reviewPath(mapId, reviewId);
  const company = await companyFor(session);
  const loaded = await loadReview(deps, actorFor(session), { mapId, companyId: company.companyId, ...(reviewId ? { reviewId } : {}) });
  if (loaded.kind === 'not_found') notFound();
  if (loaded.kind === 'problem') return <LoadProblem failure={loaded.failure} next={here} storage={session.storage} />;
  await connection();
  const today = await ownerToday(deps, session.owner.userId);
  const { read, snapshot, partnerHref } = loaded;
  const label = PARTNER_TYPE_LABELS[read.partnerType];
  const back = partnerHref
    ? { href: partnerHref, label: COPY.MAP_BACK_TO(read.partnerName || label) }
    : { href: mapPath(mapId), label: COPY.MAP_BACK_TO_MAP };
  return (
    <ReviewPage
      mapId={mapId}
      read={read}
      initial={snapshot}
      today={today}
      timeZone={await ownerTimeZone(deps, session.owner.userId)}
      actorName={session.owner.displayName}
      ourName={company.name}
      ownerName={session.owner.displayName}
      partnerHref={partnerHref}
      storage={session.storage}
      actions={{ change: mapChange, open: reviewOpen, close: reviewClose, sendSummary: reviewSummarySend, revokeSummary: reviewSummaryRevoke }}
      back={(
        <div className="flex flex-wrap items-center gap-x-2">
          <Link href={back.href} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {back.label}
          </Link>
          {partnerHref && (
            <Link href={mapPath(mapId)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{COPY.OPEN_MAP}</Link>
          )}
        </div>
      )}
    />
  );
}
