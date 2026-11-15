import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { MarketLoader, MarketSkeleton } from './market-loader';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.MARKET_LABEL };
// Saving a change to Google can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

// The address and the session are read only inside the Suspense child, so the page itself stays a static shell.
export default function MarketRoute({ params }: PageProps<'/markets/[marketId]'>) {
  return (
    <Suspense fallback={<MarketSkeleton />}>
      <WithStorage><MarketLoader params={params} /></WithStorage>
    </Suspense>
  );
}
