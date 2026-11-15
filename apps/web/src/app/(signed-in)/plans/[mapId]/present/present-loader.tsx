// The owner's present view of a MAP, read through the commands.
import { readMap, ownerToday } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { connection } from 'next/server';
import { mapPath } from '@/maps/plan-card';
import { PresentView } from '@/maps/present/present-view';
import { PrintButton } from '@/maps/present/print-button';
import { LoadProblem } from '@/markets/load-problem';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';

export async function PresentLoader({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  const here = `${mapPath(mapId)}/present`;
  const { session, deps } = await requireOwner(here);
  const company = await companyFor(session);
  const read = await readMap(deps, actorFor(session), { mapId });
  if (!read.ok) return <LoadProblem failure={read} next={here} storage={session.storage} />;
  await connection();
  const today = await ownerToday(deps, session.owner.userId);
  const { value, info, lastProgressAt } = read.value;
  return (
    <>
      <div className="mx-auto mb-6 flex w-full max-w-5xl flex-wrap items-center gap-2 print:hidden">
        <Link href={mapPath(mapId)} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {COPY.MAP_BACK_TO_MAP}
        </Link>
        <div className="ml-auto"><PrintButton /></div>
      </div>
      <PresentView plan={{ ...value, info }} today={today} lastEventAt={lastProgressAt} ourName={company.name} ownerName={session.owner.displayName} />
    </>
  );
}
