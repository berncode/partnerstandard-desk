import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PartnersLoader } from './partners-loader';
import { ListLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.PARTNERS_TITLE };
// Saving a change to Google can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

export default function PartnersPage() {
  return (
    <Suspense fallback={<ListLoading title={<h1 className="text-xl font-semibold tracking-tight">{COPY.PARTNERS_TITLE}</h1>} />}>
      <WithStorage><PartnersLoader /></WithStorage>
    </Suspense>
  );
}
