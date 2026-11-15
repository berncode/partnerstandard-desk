import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { ThisWeekLoader } from './this-week-loader';
import { StackLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.NAV_THIS_WEEK };

/**
 * The home page after sign-in (reviews spec 4.1): reviews coming up, partnerships that need you, activities due and
 * partners waiting in Recruitment. The session and the clock are read only inside the Suspense child, so the page
 * around it is a static shell (cache components).
 */
export default function ThisWeekPage() {
  return (
    <div className="grid gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{COPY.NAV_THIS_WEEK}</h1>
        <p className="mt-1 text-sm text-ink-3">{COPY.WEEK_SUBTITLE}</p>
      </div>
      <Suspense fallback={<StackLoading count={4} />}>
        <WithStorage><ThisWeekLoader /></WithStorage>
      </Suspense>
    </div>
  );
}
