import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PlanSkeleton } from '@/maps/components/plan-skeleton';
import { HeldReviewLoader } from './held-review-loader';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.REVIEW_TITLE };
// Saving notes and numbers writes the MAP to Google (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** One review by its id (reviews spec 5.3): a held review stays readable, and its notes, reasons and numbers editable. */
export default function HeldReviewRoute({ params }: PageProps<'/plans/[mapId]/review/[reviewId]'>) {
  return (
    <Suspense fallback={<PlanSkeleton />}>
      <WithStorage><HeldReviewLoader params={params} /></WithStorage>
    </Suspense>
  );
}
