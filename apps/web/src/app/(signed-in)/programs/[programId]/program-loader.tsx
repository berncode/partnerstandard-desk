import { readCompanyFacts, readProgram, type Actor, type Deps } from '@partner-desk/commands';
import type { ProgramType } from '@partner-desk/core';
import { Suspense, type ReactNode } from 'react';
import { ProgramHost } from '@/programs/program-host';
import { ProgramMembersView } from '@/programs/program-members';
import { ProgramProblem } from '@/programs/program-problem';
import { programPath } from '@/programs/steps';
import { programMembers } from '@/server/program-links';
import { programOptionsFor } from '@/server/request-programs';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { Skeleton } from '@/ui/loading';
import { hasFileLink } from '@/storage-kind';

/**
 * Reads the program and the company's facts through the commands, or says why the program can't be shown: it
 * isn't there (an unknown address, someone else's, or deleted), or it or Company facts can't be read. The editor is
 * keyed by what it shows: Reload after a refused save brings a fresh editor with the file's program, also after a
 * hand edit in the sheet (which leaves Updated as it was). The company's other programs come from the directory
 * (`programOptionsFor`), for the crumb's rule on twins; the program's partners and markets stream in after the steps.
 */
export async function ProgramLoader({ params, children }: { params: Promise<{ programId: string }>; children: ReactNode }) {
  const { programId } = await params;
  const path = programPath(programId, 'why');
  const { session, deps } = await requireOwner(path);
  const { companyId, name } = await companyFor(session);
  const actor = actorFor(session);
  const [program, listed] = await Promise.all([readProgram(deps, actor, { programId }), programOptionsFor(session)]);
  if (!program.ok) return <ProgramProblem failure={program} next={path} storage={session.storage} />;
  const facts = await readCompanyFacts(deps, actor, { companyId });
  if (!facts.ok) return <ProgramProblem facts failure={facts} next={path} storage={session.storage} />;
  const { value, issues, fileUrl } = program.value;
  const others = listed.ok ? listed.value.filter((p) => p.programId !== programId).map(({ programId: id, label }) => ({ programId: id, label })) : [];
  return (
    <ProgramHost
      key={JSON.stringify(value)}
      initial={value}
      issues={issues}
      facts={facts.value.value}
      companyName={name}
      // A test user's files live in memory: there is no spreadsheet to open.
      fileUrl={hasFileLink(session.storage) ? fileUrl : null}
      others={others}
      members={(
        <Suspense fallback={<Skeleton className="h-16 rounded-xl print:hidden" />}>
          <MembersLoader deps={deps} actor={actor} companyId={companyId} programId={programId} partnerType={value.type} />
        </Suspense>
      )}
    >
      {children}
    </ProgramHost>
  );
}

/**
 * The program's partners and the markets that feed it: a read of the Partners file and one of each open market of
 * its partner type (cached for a minute), after the steps are on screen.
 */
async function MembersLoader({ deps, actor, companyId, programId, partnerType }: {
  deps: Deps; actor: Actor; companyId: string; programId: string; partnerType: ProgramType;
}) {
  const members = await programMembers(deps, actor, companyId, programId, partnerType);
  return <ProgramMembersView members={members.ok ? members : { ok: false, message: members.message }} />;
}
