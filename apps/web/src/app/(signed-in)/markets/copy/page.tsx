import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { CopyLoader } from './copy-loader';
import { BlockLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.COPY_PAGE_TITLE };
// Copying makes a new file in Google (Recruitment's rule for pages that save).
export const maxDuration = 60;

export default function CopyMarketPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">{COPY.COPY_PAGE_TITLE}</h1>
      <p className="mt-1 text-sm text-ink-3">{COPY.COPY_PAGE_TEXT}</p>
      <Suspense fallback={<BlockLoading className="mt-6" />}>
        <WithStorage><CopyLoader /></WithStorage>
      </Suspense>
    </div>
  );
}
