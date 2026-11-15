import { listMarkets, listProposals, ownerTimeZone, ownerToday, readMarket, readPartners, type ProposalEntry } from '@partner-desk/commands';
import type { ProposalHead } from '@partner-desk/core';
import { redirect } from 'next/navigation';
import { LoadProblem } from '@/markets/load-problem';
import { oldPartnerAddress, partnerHref } from '@/partner/partner-model';
import { PartnerPage } from '@/partner/partner-page';
import type { MarketState } from '@/partner/partner-model';
import { FileProblem } from '@/problems/file-problem';
import { programLevels } from '@/server/program-links';
import { programOptionsFor } from '@/server/request-programs';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';

/**
 * Request data (the address and the session) is read only here, inside Suspense: the page itself stays a static shell.
 * It reads the Partner book, the company's markets and the file of each market this company is in, all through the commands.
 * The company's programs come from the directory; the program file of each partner type of this company that is
 * in one is read too, for its level names (one read each, usually none or one).
 * The owner's today (their Settings time zone) is the date the page's dialogs start on: Mark signed, exit, a call, a
 * new partner type. A MAP's planned start is the owner's date too, so signing "today" never offers a one-day move.
 * The way back after signing in or reconnecting keeps the open partner type (`?type`). An old address that names a
 * partner type (`/partners/p_…`) goes to its company's page on that type.
 * The person's agents' proposals for this company come from our index (ids, codes and times; no Google read), with the
 * owner's timezone and the time of the read for their dates. An index that can't be read shows no proposals.
 */
export async function PartnerLoader({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  const type = typeof query.type === 'string' && query.type !== '' ? query.type : undefined;
  const here = partnerHref(accountId, type);
  const { session, deps } = await requireOwner(here);
  const { companyId } = await companyFor(session);
  const actor = actorFor(session);
  const [book, markets, programs, today, timeZone, listed] = await Promise.all([
    readPartners(deps, actor, { companyId }), listMarkets(deps, actor, { companyId }), programOptionsFor(session),
    ownerToday(deps, session.owner.userId), ownerTimeZone(deps, session.owner.userId), listProposals(deps, actor, {}).catch(() => null),
  ]);
  const now = deps.clock();
  if (!book.ok) return <FileProblem failure={book} next={here} storage={session.storage} />;
  const moved = oldPartnerAddress(book.value.value, accountId);
  if (moved) redirect(moved);
  if (!markets.ok) return <LoadProblem failure={markets} next={here} storage={session.storage} />;

  const sectionIds = new Set(book.value.value.partners.filter((partner) => partner.accountId === accountId).map((partner) => partner.id));
  const marketIds = [...new Set(book.value.value.marketLinks.filter((link) => sectionIds.has(link.partnerId)).map((link) => link.marketId))];
  const programIds = [...new Set(book.value.value.partners.filter((p) => sectionIds.has(p.id)).flatMap((p) => p.programId ?? []))];
  const [reads, levels] = await Promise.all([
    Promise.all(marketIds.map(async (marketId) => [marketId, await readMarket(deps, actor, { marketId })] as const)),
    programLevels(deps, actor, programIds),
  ]);
  const read = reads.map(([marketId, market]): [string, MarketState] =>
    [marketId, market.ok ? { status: 'ready', market: market.value.value } : { status: 'failed', message: market.message }]);
  const authFailure = reads.map(([, market]) => market).find((market) => !market.ok && market.error === 'auth');

  // A linked market's file that needs a new Google sign-in: the page still opens, with Reconnect Google above it.
  return (
    <>
      {authFailure && !authFailure.ok && <LoadProblem failure={authFailure} next={here} storage={session.storage} />}
      <PartnerPage
        initial={book.value}
        accountId={accountId}
        markets={markets.value.map(({ marketId, displayName, archived }) => ({ marketId, displayName, archived }))}
        linkedMarkets={Object.fromEntries(read)}
        // A list that can't be read offers no program, and a partner's program shows as its stored id, not deleted.
        programs={programs.ok ? programs.value : []}
        programsListed={programs.ok}
        levels={levels}
        actor={session.owner.displayName}
        today={today}
        storage={session.storage}
        proposals={listed?.ok ? headsFor(listed.value, accountId) : []}
        timeZone={timeZone}
        now={now}
      />
    </>
  );
}

/** The index's entries about this company, as the cards need them: no file ids, no makers. */
function headsFor(entries: readonly ProposalEntry[], accountId: string): ProposalHead[] {
  return entries.filter((e) => e.accountId === accountId).map(({ id, kind, status, createdAt, answeredAt, expiresAt, agentName, makerOn }) => ({
    id, kind, status, createdAt, answeredAt, expiresAt, agentName, makerOn,
  }));
}
