import { COPY } from '@partner-desk/copy';
import { Copy, Plus } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { buttonVariants } from '@/ui/button';
import { MarketsLoader } from './markets-loader';
import { CardsLoading } from '@/ui/loading';
import { NotForViewer } from '@/not-for-viewer';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.MARKETS_PAGE_TITLE };
// Archiving writes nothing to Google, but the page shares the saving pages' limit (Recruitment's rule).
export const maxDuration = 60;

// The session and the address are read only inside the Suspense child, so the page itself stays a static shell.
export default function MarketsPage(props: PageProps<'/markets'>) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold tracking-tight">{COPY.MARKETS_PAGE_TITLE}</h1>
          <p className="mt-1 text-sm text-ink-3">{COPY.MARKETS_PAGE_SUBTITLE}</p>
        </div>
        <NotForViewer>
          <Link href="/markets/copy" className={buttonVariants()}>
            <Copy className="h-4 w-4" aria-hidden />
            {COPY.COPY_FROM_ANOTHER_MARKET}
          </Link>
          <Link href="/markets/new" className={buttonVariants({ variant: 'primary' })}>
            <Plus className="h-4 w-4" aria-hidden />
            {COPY.NEW_MARKET}
          </Link>
        </NotForViewer>
      </div>
      <Suspense fallback={<CardsLoading />}>
        <WithStorage><MarketsLoader searchParams={props.searchParams} /></WithStorage>
      </Suspense>
    </div>
  );
}
