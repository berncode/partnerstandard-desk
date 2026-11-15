import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { LoadProblem } from '@/markets/load-problem';
import { ProgramCards } from '@/programs/program-cards';
import { programsOverview } from '@/server/program-links';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';

const PATH = '/programs';

/**
 * The company's programs as cards, with their partners per level and the markets that feed them (`programsOverview`).
 * A read that failed for a reason the person can act on (an expired Google sign-in) shows above the cards, with
 * Reconnect Google, as on Markets.
 */
export async function ProgramsLoader() {
  const { session, deps } = await requireOwner(PATH);
  const { companyId } = await companyFor(session);
  const read = await programsOverview(deps, actorFor(session), companyId);
  if (!read.ok) return <LoadProblem failure={read} next={PATH} storage={session.storage} />;
  const { rows, problem } = read.value;
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
        <h2 className="text-[15px] font-semibold">{COPY.PROGRAMS_EMPTY_TITLE}</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-2">{COPY.PROGRAMS_EMPTY_TEXT}</p>
        {/* A company server's viewer can't make a program: no button for it (owner, 2026-11-14). */}
        {session.member?.role !== 'viewer' && (
          <Link href="/programs/new" className={buttonVariants({ variant: 'primary', className: 'mt-6' })}>{COPY.PROGRAMS_EMPTY_ACTION}</Link>
        )}
      </div>
    );
  }
  return (
    <>
      {problem && <LoadProblem failure={problem.failure} partnersFile={problem.partnersFile} next={PATH} storage={session.storage} />}
      <ProgramCards rows={rows} />
    </>
  );
}
