import { listMarkets, readPartners } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { MarketCard, UnarchiveButton } from '@/markets/market-card';
import { countsFor } from '@/markets/markets-model';
import { LoadProblem } from '@/markets/load-problem';
import { buttonVariants } from '@/ui/button';
import { Tip } from '@/ui/pieces';

/**
 * The company's markets as cards. The directory lists them (name, archived or not) and the Partner book is read once
 * for every card's counts: no market file is read here.
 */
export async function MarketsLoader({ searchParams }: { searchParams: PageProps<'/markets'>['searchParams'] }) {
  const [{ session, deps }, params] = await Promise.all([requireOwner('/markets'), searchParams]);
  const { companyId } = await companyFor(session);
  const actor = actorFor(session);
  const [listing, book] = await Promise.all([listMarkets(deps, actor, { companyId }), readPartners(deps, actor, { companyId })]);
  if (!listing.ok) return <LoadProblem failure={listing} next="/markets" storage={session.storage} />;
  const open = listing.value.filter((m) => !m.archived);
  const archived = listing.value.filter((m) => m.archived);
  const showArchived = params.archived === '1';
  // A company server's viewer can't make a market: no button for it (owner, 2026-11-14). Archive hides itself.
  const viewer = session.member?.role === 'viewer';
  return (
    <>
      {/* The tip says to pick a market: with none yet, the empty state says to create one instead. */}
      {params.find === 'partners' && open.length > 0 && <Tip>{COPY.FIND_PARTNERS_TIP}</Tip>}
      {!book.ok && <LoadProblem failure={book} partnersFile next="/markets" storage={session.storage} />}
      {open.length === 0 ? <EmptyState viewer={viewer} /> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((m) => (
            <li key={m.marketId} className="min-w-0">
              <MarketCard marketId={m.marketId} displayName={m.displayName} counts={book.ok ? countsFor(book.value.value, m.marketId) : null} />
            </li>
          ))}
        </ul>
      )}
      {showArchived ? (
        <section aria-labelledby="archived-heading" className="mt-4 rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="archived-heading" className="min-w-0 flex-1 font-medium">{COPY.ARCHIVED_MARKETS}</h2>
            <Link href="/markets" className="text-sm text-ink-3 underline-offset-2 hover:text-ink hover:underline">{COPY.HIDE_ARCHIVED}</Link>
          </div>
          {archived.length === 0 ? <p className="mt-2 text-sm text-ink-3">{COPY.NO_ARCHIVED_MARKETS}</p> : (
            <ul className="mt-2 divide-y divide-line">
              {archived.map((m) => (
                <li key={m.marketId} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 break-words text-sm">{m.displayName}</span>
                  <UnarchiveButton marketId={m.marketId} displayName={m.displayName} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="mt-4 text-sm">
          <Link href="/markets?archived=1" className="text-ink-3 underline-offset-2 hover:text-ink hover:underline">{COPY.SHOW_ARCHIVED}</Link>
        </p>
      )}
    </>
  );
}

function EmptyState({ viewer }: { viewer: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <h2 className="text-[15px] font-semibold">{COPY.MARKETS_EMPTY_TITLE}</h2>
      <p className="mx-auto mt-2 max-w-md text-ink-2">{COPY.MARKETS_EMPTY_TEXT}</p>
      {!viewer && <Link href="/markets/new" className={buttonVariants({ variant: 'primary', className: 'mt-6' })}>{COPY.CREATE_FIRST_MARKET}</Link>}
    </div>
  );
}
