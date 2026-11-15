import { COPY } from '@partner-desk/copy';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { buttonVariants } from '@/ui/button';
import { ProgramsLoader } from './programs-loader';
import { CardsLoading } from '@/ui/loading';
import { NotForViewer } from '@/not-for-viewer';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.NAV_PROGRAMS };
// Copy and Delete write to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** The company's programs (owner, 2026-10-30), like Markets. The session is read only inside the Suspense child. */
export default function ProgramsPage() {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold tracking-tight">{COPY.NAV_PROGRAMS}</h1>
          <p className="mt-1 text-sm text-ink-3">{COPY.PROGRAMS_PAGE_SUBTITLE}</p>
        </div>
        <NotForViewer>
          <Link href="/programs/new" className={buttonVariants({ variant: 'primary' })}>
            <Plus className="h-4 w-4" aria-hidden />
            {COPY.NAV_ADD_PROGRAM}
          </Link>
        </NotForViewer>
      </div>
      <Suspense fallback={<CardsLoading />}>
        <WithStorage><ProgramsLoader /></WithStorage>
      </Suspense>
    </div>
  );
}
