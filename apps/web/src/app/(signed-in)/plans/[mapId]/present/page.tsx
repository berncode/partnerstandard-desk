import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PresentLoader } from './present-loader';
import { BlockLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.MAP_PRESENT };

/**
 * The MAP's present view (MAP 3.5): the plan read-only, large, to hold a meeting or print to PDF with the browser, on
 * A4 or Letter. Inside the app frame, whose sidebar and header stay off the paper.
 */
export default function PresentPage({ params }: PageProps<'/plans/[mapId]/present'>) {
  return (
    <Suspense fallback={<BlockLoading className="mx-auto w-full max-w-5xl" />}>
      <WithStorage><PresentLoader params={params} /></WithStorage>
    </Suspense>
  );
}
