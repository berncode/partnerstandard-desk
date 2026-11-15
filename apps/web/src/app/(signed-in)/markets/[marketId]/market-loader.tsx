import { listMarkets, listProposals, ownerTimeZone, readMarket, readPartners, type ProposalEntry } from '@partner-desk/commands';
import type { ProposalHead } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { notFound } from 'next/navigation';
import { MarketPage } from '@/market/market-page';
import { MarketProblem } from '@/market/market-problem';
import { LoadProblem } from '@/markets/load-problem';
import { programLevels } from '@/server/program-links';
import { programOptionsFor } from '@/server/request-programs';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { CardSkeleton, Loading, Skeleton } from '@/ui/loading';
import { hasFileLink } from '@/storage-kind';

/**
 * Loads one of the person's markets with the company's Partner book, market listing and programs (from the
 * directory; a read each only for twin programs' names), all through the commands, or
 * says why it can't be shown. A market the listing doesn't hold (someone else's, or none) is not found; a file that
 * can't be read gets the problem page (Archive for a file that is gone, Reconnect Google for an expired sign-in).
 * The person's agents' proposals about this market come from our index (ids, codes and times; no Google read), with the
 * owner's timezone and the time of the read for their dates. An index that can't be read shows no proposals.
 */
export async function MarketLoader({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const path = `/markets/${encodeURIComponent(marketId)}`;
  const { session, deps } = await requireOwner(path);
  const { companyId, name: companyName } = await companyFor(session);
  const actor = actorFor(session);
  const listing = await listMarkets(deps, actor, { companyId });
  if (!listing.ok) return <LoadProblem failure={listing} next={path} storage={session.storage} />;
  if (!listing.value.some((m) => m.marketId === marketId)) notFound();

  const [market, book, programs, timeZone, listed] = await Promise.all([
    readMarket(deps, actor, { marketId }), readPartners(deps, actor, { companyId }), programOptionsFor(session),
    ownerTimeZone(deps, session.owner.userId), listProposals(deps, actor, {}).catch(() => null),
  ]);
  const now = deps.clock();
  if (!market.ok) return <MarketProblem marketId={marketId} failure={market} storage={session.storage} />;
  if (!book.ok) return <LoadProblem failure={book} partnersFile next={path} storage={session.storage} />;
  const { fileUrl, ...snapshot } = market.value;
  // The program the market feeds, when listed, is read once (cached a minute): a file trashed by hand shows as gone.
  const feeds = snapshot.value.info.feedsProgramId;
  let offered = programs.ok ? programs.value : [];
  if (feeds && offered.some((p) => p.programId === feeds)) {
    const levels = await programLevels(deps, actor, [feeds]);
    if (levels[feeds]?.status === 'gone') offered = offered.filter((p) => p.programId !== feeds);
  }

  return (
    <MarketPage
      initialMarket={snapshot}
      initialBook={book.value}
      markets={listing.value.map(({ marketId: id, displayName, archived }) => ({ marketId: id, displayName, archived }))}
      // A list that can't be read offers no program, and the one the market feeds shows as its stored id, not deleted.
      programs={offered}
      programsListed={programs.ok}
      companyName={companyName}
      // A test user's files live in memory: there is no spreadsheet to open.
      fileUrl={hasFileLink(session.storage) ? fileUrl : null}
      actor={session.owner.displayName}
      storage={session.storage}
      proposals={listed?.ok ? headsFor(listed.value, marketId) : []}
      timeZone={timeZone}
      now={now}
    />
  );
}

/** The index's entries about this market (new partners, a hypothesis's or its status), as the cards need them. */
function headsFor(entries: readonly ProposalEntry[], marketId: string): ProposalHead[] {
  return entries.filter((e) => e.marketId === marketId).map(({ id, kind, status, createdAt, answeredAt, expiresAt, agentName, makerOn }) => ({
    id, kind, status, createdAt, answeredAt, expiresAt, agentName, makerOn,
  }));
}

export function MarketSkeleton() {
  return (
    <Loading label={COPY.MARKET_LOADING_PAGE} className="grid gap-4">
      <CardSkeleton lines={2} />
      <Skeleton className="h-10 rounded-xl" />
      <CardSkeleton lines={8} />
    </Loading>
  );
}
