import { listMarkets } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { CopyForm } from '@/markets/copy-form';
import { LoadProblem } from '@/markets/load-problem';
import { buttonVariants } from '@/ui/button';

/** The markets that can be copied (the open ones), or a way to make the first. */
export async function CopyLoader() {
  const { session, deps } = await requireOwner('/markets/copy');
  // A company server's viewer makes nothing: the page they reached by its address sends them to the list (owner, 2026-11-14).
  if (session.member?.role === 'viewer') redirect('/markets');
  const { companyId } = await companyFor(session);
  const listing = await listMarkets(deps, actorFor(session), { companyId });
  if (!listing.ok) return <div className="mt-6"><LoadProblem failure={listing} next="/markets/copy" storage={session.storage} /></div>;
  const sources = listing.value.filter((m) => !m.archived).map(({ marketId, displayName }) => ({ marketId, displayName }));
  if (sources.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-line px-4 py-6 text-center">
        <p className="text-ink-2">{COPY.COPY_NO_MARKET}</p>
        <Link href="/markets/new" className={buttonVariants({ variant: 'primary', className: 'mt-4' })}>{COPY.NEW_MARKET}</Link>
      </div>
    );
  }
  return <CopyForm sources={sources} storage={session.storage} />;
}
