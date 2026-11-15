import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { ReviewPresentLoader } from './review-present-loader';
import { BlockLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.REVIEW_PRESENT_TITLE };

/**
 * The review's present view (reviews spec 5.2): read-only and large, to share a screen in the meeting or print to PDF on
 * A4 or Letter. The current horizon's review, or a held one with `?review={id}`.
 */
export default function ReviewPresentRoute({ params, searchParams }: PageProps<'/plans/[mapId]/review/present'>) {
  return (
    <Suspense fallback={<BlockLoading className="mx-auto w-full max-w-5xl" />}>
      <WithStorage><ReviewPresentLoader params={params} searchParams={searchParams} /></WithStorage>
    </Suspense>
  );
}
