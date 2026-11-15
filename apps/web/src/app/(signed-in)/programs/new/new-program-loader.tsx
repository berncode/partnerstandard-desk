import { redirect } from 'next/navigation';
import { LoadProblem } from '@/markets/load-problem';
import { AddProgramForm } from '@/programs/add-program-form';
import { programOptionsFor } from '@/server/request-programs';
import { companyFor, requireOwner } from '@/server/runtime';

const PATH = '/programs/new';

/**
 * The company's programs with their titles, for the copies and "You have one already.": the directory's list, plus
 * the names of programs that share a label (one read each, `programOptionsFor`).
 */
export async function NewProgramLoader() {
  const { session } = await requireOwner(PATH);
  // A company server's viewer makes nothing: the page they reached by its address sends them to the list (owner, 2026-11-14).
  if (session.member?.role === 'viewer') redirect('/programs');
  const { name } = await companyFor(session);
  const listed = await programOptionsFor(session);
  if (!listed.ok) return <LoadProblem failure={listed} next={PATH} storage={session.storage} />;
  return <AddProgramForm companyName={name} programs={listed.value} />;
}
