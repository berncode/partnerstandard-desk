import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { ReviewsLoader } from './reviews-loader';
import { StackLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.NAV_REVIEWS };

/**
 * Every partner review of the company (reviews spec 6): the ones coming up first, then prep started, then the held
 * ones. The session is read only inside the Suspense child.
 */
export default function ReviewsPage() {
  return (
    <div className="grid gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{COPY.NAV_REVIEWS}</h1>
        <p className="mt-1 text-sm text-ink-3">{COPY.REVIEWS_SUBTITLE}</p>
      </div>
      <Suspense fallback={<StackLoading count={2} />}>
        <WithStorage><ReviewsLoader /></WithStorage>
      </Suspense>
    </div>
  );
}
