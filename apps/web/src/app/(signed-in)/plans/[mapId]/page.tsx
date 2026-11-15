import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PlanSkeleton } from '@/maps/components/plan-skeleton';
import { MapLoader } from './map-loader';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.MAP_TITLE };

/**
 * A MAP on its own page inside the app frame (spec 5.1, 6): the MAP app's plan page, with the header "Acme as reseller"
 * and a link back to the partner. Its present view is at /plans/{mapId}/present.
 */
export default function MapPage({ params }: PageProps<'/plans/[mapId]'>) {
  return (
    <Suspense fallback={<PlanSkeleton />}>
      <WithStorage><MapLoader params={params} /></WithStorage>
    </Suspense>
  );
}
