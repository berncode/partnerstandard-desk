import { GUIDED_STEPS } from '@partner-desk/method';
import { Suspense } from 'react';
import { StartLoader } from './start-loader';
import { BlockLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: GUIDED_STEPS[0]!.title };
// Saving the MAP writes to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** The guided first MAP (spec 5.2, MAP 3.1), for a MAP Start the MAP has just made. */
export default function StartMapPage({ params }: PageProps<'/plans/[mapId]/start'>) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <WithStorage><StartLoader params={params} /></WithStorage>
    </Suspense>
  );
}
