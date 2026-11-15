import { listMapIds, listMarkets, ownerToday, readPartners } from '@partner-desk/commands';
import { LoadProblem } from '@/markets/load-problem';
import { FileProblem } from '@/problems/file-problem';
import { programOptionsFor } from '@/server/request-programs';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { PartnersView } from './partners-view';

/**
 * Request data (the session) is read only here, inside Suspense: the page itself stays a static shell. It reads the
 * Partner book, the company's markets and its programs (from the directory) through the commands and hands the
 * snapshot to the screen, with the MAPs the directory lists (no file read): they tell an empty MAP ("Nothing planned
 * yet", no health on its row) from no MAP.
 */
export async function PartnersLoader() {
  const { session, deps } = await requireOwner('/partners');
  const { companyId } = await companyFor(session);
  const actor = actorFor(session);
  const [book, markets, programs, maps, today] = await Promise.all([
    readPartners(deps, actor, { companyId }), listMarkets(deps, actor, { companyId }), programOptionsFor(session),
    // A list that can't be read only loses "Nothing planned yet": such a MAP shows as no MAP, never stopping the page.
    listMapIds(deps, actor, { companyId }).catch(() => null),
    // The date Add partner's "Signed on" starts on: the owner's, as a MAP's planned start is.
    ownerToday(deps, session.owner.userId),
  ]);
  if (!book.ok) return <FileProblem failure={book} next="/partners" storage={session.storage} />;
  if (!markets.ok) return <LoadProblem failure={markets} next="/partners" storage={session.storage} />;
  return (
    <PartnersView
      initial={book.value}
      markets={markets.value.map(({ marketId, displayName, archived }) => ({ marketId, displayName, archived }))}
      // A list that can't be read shows partners' programs by their stored id rather than stopping the page.
      programs={programs.ok ? programs.value : []}
      programsListed={programs.ok}
      mapPartnerIds={maps?.ok ? maps.value.map((m) => m.partnerId) : []}
      actor={session.owner.displayName}
      today={today}
      storage={session.storage}
    />
  );
}
