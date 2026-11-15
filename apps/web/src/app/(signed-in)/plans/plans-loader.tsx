import { listMaps, readMap, type Actor, type Deps, type MapListItem, ownerToday } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { mapDelete } from '@/app/(signed-in)/actions/maps';
import { PendingCards, PlanCards, PlanProblems, type PlanProblem } from '@/maps/plan-cards';
import { cardOf, mayDeleteAfter, sortByAttention, type PlanCard } from '@/maps/view-model';
import { LoadProblem } from '@/markets/load-problem';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';

const PATH = '/plans';

/**
 * The company's MAPs: their names from the directory at once, then each MAP read (one after another, as Google allows
 * about 60 reads a minute) for its card, sorted by what needs attention. A MAP that can't be read is listed below the
 * cards with why, as the MAP app's dashboard does.
 */
export async function PlansLoader() {
  const { session, deps } = await requireOwner(PATH);
  const { companyId } = await companyFor(session);
  const actor = actorFor(session);
  const listed = await listMaps(deps, actor, { companyId });
  if (!listed.ok) return <LoadProblem failure={listed} partnersFile next={PATH} storage={session.storage} />;
  if (listed.value.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
        <h2 className="text-[15px] font-semibold">{COPY.PLANS_EMPTY_TITLE}</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-2">{COPY.PLANS_EMPTY_TEXT}</p>
        <Link href="/partners" className={buttonVariants({ variant: 'primary', className: 'mt-6' })}>{COPY.GO_TO_PARTNERS}</Link>
      </div>
    );
  }
  return (
    <Suspense fallback={<PendingCards names={listed.value.map(({ mapId, displayName }) => ({ mapId, displayName }))} />}>
      <Cards deps={deps} actor={actor} items={listed.value} />
    </Suspense>
  );
}

async function Cards({ deps, actor, items }: { deps: Deps; actor: Actor; items: MapListItem[] }) {
  // Before the clock: a request-time API, so "today" is the request's.
  await connection();
  const today = await ownerToday(deps, actor.userId);
  const cards: PlanCard[] = [];
  const problems: PlanProblem[] = [];
  for (const item of items) {
    const read = await readMap(deps, actor, { mapId: item.mapId });
    if (read.ok) cards.push(cardOf(item, read.value, today));
    else problems.push({ mapId: item.mapId, displayName: item.displayName, message: read.message, deletable: mayDeleteAfter(read.error) });
  }
  return (
    <div className="grid gap-4">
      {cards.length > 0 && <PlanCards cards={sortByAttention(cards)} today={today} />}
      <PlanProblems problems={problems} remove={mapDelete} />
    </div>
  );
}
