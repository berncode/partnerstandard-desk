import { listCases, readPartners } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { caseCards } from '@/cases/case-rows';
import { CaseCards } from '@/cases/case-cards';
import { LoadProblem } from '@/markets/load-problem';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { buttonVariants } from '@/ui/button';

const PATH = '/business-cases';

/**
 * The company's cases as cards, from the directory and one read of Partners for the partners' names and pages: no
 * case file is read [builder's call, spec 6]. A Partners file that can't be read still shows the cards, by their
 * partner type, with the problem above them.
 */
export async function CasesLoader() {
  const { session, deps } = await requireOwner(PATH);
  const { companyId } = await companyFor(session);
  const actor = actorFor(session);
  const listed = await listCases(deps, actor, { companyId });
  if (!listed.ok) return <LoadProblem failure={listed} next={PATH} storage={session.storage} />;
  if (listed.value.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
        <h2 className="text-[15px] font-semibold">{COPY.CASES_EMPTY_TITLE}</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-2">{COPY.CASES_EMPTY_TEXT}</p>
        {/* A company server's viewer can't make a case: no button for it (owner, 2026-11-14). */}
        {session.member?.role !== 'viewer' && (
          <Link href="/business-cases/new" className={buttonVariants({ variant: 'primary', className: 'mt-6' })}>{COPY.NEW_CASE}</Link>
        )}
      </div>
    );
  }
  const book = await readPartners(deps, actor, { companyId });
  return (
    <>
      {!book.ok && <LoadProblem failure={book} partnersFile next={PATH} storage={session.storage} />}
      <CaseCards rows={caseCards(listed.value, book.ok ? book.value.value : null)} />
    </>
  );
}
