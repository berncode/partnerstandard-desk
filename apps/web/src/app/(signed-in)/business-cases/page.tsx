import { COPY } from '@partner-desk/copy';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { buttonVariants } from '@/ui/button';
import { CasesLoader } from './cases-loader';
import { CardsLoading } from '@/ui/loading';
import { NotForViewer } from '@/not-for-viewer';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.NAV_BUSINESS_CASES };
// Copy and Delete write to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** Every business case of the company (spec 6), like Programs. The session is read only inside the Suspense child. */
export default function BusinessCasesPage() {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold tracking-tight">{COPY.NAV_BUSINESS_CASES}</h1>
          <p className="mt-1 text-sm text-ink-3">{COPY.CASES_PAGE_SUBTITLE}</p>
        </div>
        <NotForViewer>
          <Link href="/business-cases/new" className={buttonVariants({ variant: 'primary' })}>
            <Plus className="h-4 w-4" aria-hidden />
            {COPY.NEW_CASE}
          </Link>
        </NotForViewer>
      </div>
      <Suspense fallback={<CardsLoading />}>
        <WithStorage><CasesLoader /></WithStorage>
      </Suspense>
    </div>
  );
}
