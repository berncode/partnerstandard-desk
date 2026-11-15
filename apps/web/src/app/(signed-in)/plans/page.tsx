import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PlansLoader } from './plans-loader';
import { CardsLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.NAV_PLANS };

/**
 * Every MAP of the company (spec 5.1, 6), like the MAP app's dashboard: plans that need attention first. The session is
 * read only inside the Suspense child.
 */
export default function PlansPage() {
  return (
    <div className="grid gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{COPY.NAV_PLANS}</h1>
        <p className="mt-1 text-sm text-ink-3">{COPY.PLANS_SUBTITLE}</p>
      </div>
      <Suspense fallback={<CardsLoading />}>
        <WithStorage><PlansLoader /></WithStorage>
      </Suspense>
    </div>
  );
}
