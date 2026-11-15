import { ownerToday } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { PrintButton } from '@/maps/present/print-button';
import { LoadProblem } from '@/markets/load-problem';
import { loadReview } from '@/reviews/review-loader';
import { reviewPath, reviewPresentPath } from '@/reviews/review-model';
import { ReviewPresent } from '@/reviews/review-present';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';

/** The review's present view for the signed-in owner only: a person with a link, or a review that isn't there, is not found. */
export async function ReviewPresentLoader({ params, searchParams }: {
  params: Promise<{ mapId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mapId } = await params;
  const asked = (await searchParams).review;
  const reviewId = typeof asked === 'string' && asked !== '' ? asked : undefined;
  const here = reviewPresentPath(mapId, reviewId);
  const { session, deps } = await requireOwner(here);
  const company = await companyFor(session);
  const loaded = await loadReview(deps, actorFor(session), { mapId, companyId: company.companyId, ...(reviewId ? { reviewId } : {}) });
  if (loaded.kind === 'not_found') notFound();
  if (loaded.kind === 'problem') return <LoadProblem failure={loaded.failure} next={here} storage={session.storage} />;
  await connection();
  const today = await ownerToday(deps, session.owner.userId);
  return (
    <>
      <div className="mx-auto mb-6 flex w-full max-w-5xl flex-wrap items-center gap-2 print:hidden">
        <Link href={reviewPath(mapId, reviewId)} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {COPY.REVIEW_BACK_TO_REVIEW}
        </Link>
        <div className="ml-auto"><PrintButton /></div>
      </div>
      <ReviewPresent read={loaded.read} today={today} ourName={company.name} ownerName={session.owner.displayName} />
    </>
  );
}
