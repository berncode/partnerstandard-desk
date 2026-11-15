import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PlanSkeleton } from '@/maps/components/plan-skeleton';
import { ReviewPageLoader } from './review-page-loader';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.REVIEW_TITLE };
// Closing a review writes the MAP to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/**
 * The current horizon's review (reviews spec 5.2): before prep its date and Start the prep, then the prep page. Its
 * present view is at /plans/{mapId}/review/present; a held review is at /plans/{mapId}/review/{reviewId}.
 */
export default function ReviewRoute({ params }: PageProps<'/plans/[mapId]/review'>) {
  return (
    <Suspense fallback={<PlanSkeleton />}>
      <WithStorage><ReviewPageLoader params={params} /></WithStorage>
    </Suspense>
  );
}
