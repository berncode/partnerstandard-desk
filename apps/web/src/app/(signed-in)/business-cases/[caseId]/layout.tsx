import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { CaseLoader } from './case-loader';
import { CardSkeleton, Loading, Skeleton } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

/**
 * Around every tab of a case (spec 6): reads it once and keeps one editor (one autosave, one save at a time) while
 * the tabs change, as a program's layout does for its steps. One route per tab, so each has its own address and Back
 * works.
 */
export default function CaseLayout({ params, children }: LayoutProps<'/business-cases/[caseId]'>) {
  return (
    <Suspense fallback={<CaseSkeleton />}>
      <WithStorage><CaseLoader params={params}>{children}</CaseLoader></WithStorage>
    </Suspense>
  );
}

function CaseSkeleton() {
  return (
    <Loading label={COPY.CASE_LOADING} className="grid gap-4">
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-14 rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-[410px_minmax(0,1fr)]">
        {[0, 1].map((i) => <CardSkeleton key={i} lines={8} />)}
      </div>
    </Loading>
  );
}
