import { listMarkets, readMarket, readPartners } from '@partner-desk/commands';
import { redirect } from 'next/navigation';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { LoadProblem } from '@/markets/load-problem';
import { GuidedFlow } from '@/markets/guided-flow';

/**
 * Step 1 starts from the newest market's product and target customers (Recruitment's rule), read from the last open
 * market in the listing; a market that can't be read just means empty fields. The Partner book comes along for the
 * search prompt and the first partners' duplicate check.
 */
export async function NewMarketLoader({ searchParams }: { searchParams: PageProps<'/markets/new'>['searchParams'] }) {
  const [{ session, deps }, params] = await Promise.all([requireOwner('/markets/new'), searchParams]);
  // A company server's viewer makes nothing: the page they reached by its address sends them to the list (owner, 2026-11-14).
  if (session.member?.role === 'viewer') redirect('/markets');
  const { companyId, name } = await companyFor(session);
  const actor = actorFor(session);
  const [book, listing] = await Promise.all([readPartners(deps, actor, { companyId }), listMarkets(deps, actor, { companyId })]);
  if (!book.ok) return <LoadProblem failure={book} partnersFile next="/markets/new" storage={session.storage} />;
  const newest = listing.ok ? listing.value.filter((m) => !m.archived).at(-1) : undefined;
  const market = newest ? await readMarket(deps, actor, { marketId: newest.marketId }) : null;
  const defaults = market?.ok ? { ourProduct: market.value.value.info.ourProduct, ourTargetCustomers: market.value.value.info.ourTargetCustomers } : { ourProduct: '', ourTargetCustomers: '' };
  const step = typeof params.step === 'string' ? params.step : null;
  return <GuidedFlow defaults={defaults} companyName={name} book={book.value.value} ownerId={session.owner.userId} storage={session.storage} initialStep={step} />;
}
