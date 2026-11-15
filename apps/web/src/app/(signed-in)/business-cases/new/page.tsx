import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { NewCaseLoader } from './new-case-loader';
import { BlockLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.NEW_CASE };
// Making a case writes a file to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** New case (spec 6): the partner and its type, then the program when it must be picked. `?partner=` picks one first. */
export default function NewCasePage({ searchParams }: PageProps<'/business-cases/new'>) {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{COPY.NEW_CASE}</h1>
        <p className="mt-1 text-sm text-ink-3">{COPY.NEW_CASE_TEXT}</p>
      </div>
      <Suspense fallback={<BlockLoading />}>
        <WithStorage><NewCaseLoader searchParams={searchParams} /></WithStorage>
      </Suspense>
    </div>
  );
}
