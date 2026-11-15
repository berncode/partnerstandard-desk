import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PartnerLoader } from './partner-loader';
import { DetailLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.PARTNERS_TITLE };
// Saving a change to Google can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

export default function PartnerRoute({ params, searchParams }: PageProps<'/partners/[accountId]'>) {
  return (
    <Suspense fallback={<DetailLoading />}>
      <WithStorage><PartnerLoader params={params} searchParams={searchParams} /></WithStorage>
    </Suspense>
  );
}
