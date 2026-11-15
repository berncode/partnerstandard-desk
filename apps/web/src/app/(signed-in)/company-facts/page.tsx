import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { FactsLoader, FactsSkeleton } from './facts-loader';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.FACTS_TITLE };
// Saving to Google can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** Company facts. The session and the file are read only inside the Suspense child, so the page stays a static shell. */
export default function CompanyFactsPage() {
  return (
    <Suspense fallback={<FactsSkeleton />}>
      <WithStorage><FactsLoader /></WithStorage>
    </Suspense>
  );
}
