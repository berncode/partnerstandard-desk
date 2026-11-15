import { ownerToday } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LinkFrame, LinkNotice } from '@/app/c/link-frame';
import { PresentView } from '@/maps/present/present-view';
import { PrintButton } from '@/maps/present/print-button';
import { linkMapPath } from '@/server/map-session';
import { buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { readForLink } from '../link-loader';
import { BlockLoading } from '@/ui/loading';

export const metadata: Metadata = { title: COPY.MAP_PRESENT, robots: { index: false, follow: false } };

/** The present view for a person with a link: the MAP read-only, to hold a meeting or print, as the owner's. */
export default function LinkPresentPage({ params }: PageProps<'/m/[mapId]/present'>) {
  return (
    <LinkFrame wide>
      <Suspense fallback={<BlockLoading className="mx-auto w-full max-w-5xl" />}>
        <LinkPresentLoader params={params} />
      </Suspense>
    </LinkFrame>
  );
}

async function LinkPresentLoader({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  const found = await readForLink(mapId);
  if (found.kind === 'unavailable') return <LinkNotice title={COPY.MAP_TITLE}>{COPY.LINK_MAP_UNAVAILABLE}</LinkNotice>;
  const { holder, read } = found;
  return (
    <>
      <div className="mx-auto mb-6 flex w-full max-w-5xl flex-wrap items-center gap-2 print:hidden">
        <Link href={linkMapPath(mapId)} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {COPY.MAP_BACK_TO_MAP}
        </Link>
        <div className="ml-auto"><PrintButton /></div>
      </div>
      <PresentView
        plan={{ ...read.value, info: read.info }} today={await ownerToday(holder.deps, holder.actor.userId)} lastEventAt={read.lastProgressAt}
        ourName={holder.ourName} ownerName={holder.ownerName}
      />
    </>
  );
}
