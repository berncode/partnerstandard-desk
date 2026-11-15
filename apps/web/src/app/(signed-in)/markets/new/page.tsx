import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { NewMarketLoader } from './new-market-loader';
import { BlockLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.NEW_MARKET };
// The first partners are saved to Google after the market is made (Recruitment's rule for pages that save).
export const maxDuration = 60;

export default function NewMarketPage(props: PageProps<'/markets/new'>) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <WithStorage><NewMarketLoader searchParams={props.searchParams} /></WithStorage>
    </Suspense>
  );
}
