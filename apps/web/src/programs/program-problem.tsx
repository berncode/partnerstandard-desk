import { COPY, copyFor } from '@partner-desk/copy';
import { FileWarning } from 'lucide-react';
import Link from 'next/link';
import { ReconnectButton } from '@/problems/reconnect';
import { buttonVariants } from '@/ui/button';
import type { StorageKind } from '@/storage-kind';

/** The heading for each problem, in the words of where the work lives (plan 13, task 12). */
const headings = (storage: StorageKind): Record<string, string> => ({
  structure: COPY.PROG_PROBLEM_STRUCTURE,
  auth: COPY.PROBLEM_AUTH,
  unavailable: copyFor(storage).PROBLEM_UNAVAILABLE,
});

const FACTS_HEADINGS: Record<string, string> = { file_not_found: COPY.FACTS_PROBLEM_GONE, structure: COPY.FACTS_PROBLEM_STRUCTURE };

/**
 * A program that can't be shown, in the look of Company facts' problem page (FactsProblem). One that isn't there (an
 * unknown address, someone else's, deleted, or its file gone from Drive) says so; one that can't be read gives the
 * store's message, which names what to fix in the sheet; an expired Google sign-in offers Reconnect Google.
 * `facts`: the refused read was Company facts', not the program's.
 */
export function ProgramProblem({ failure, next, storage, facts = false }: {
  failure: { error: string; message: string }; next: string; storage: StorageKind; facts?: boolean;
}) {
  const { error, message } = failure;
  // `invalid`: an address that can't be a program id. Like one that isn't there.
  const gone = !facts && (error === 'file_not_found' || error === 'not_found' || error === 'invalid');
  const heading = facts ? FACTS_HEADINGS[error] ?? headings(storage)[error] ?? COPY.FACTS_PROBLEM_OTHER
    : gone ? COPY.PROGRAM_NOT_FOUND : headings(storage)[error] ?? COPY.PROG_PROBLEM_OTHER;
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center">
      <FileWarning className="mx-auto h-10 w-10 text-warn" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">{heading}</h1>
      {!gone && <p className="mt-2 break-words text-ink-2">{message}</p>}
      {error === 'unavailable' && <p className="mt-1 text-sm text-ink-3">{COPY.PROBLEM_WAIT}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {error === 'auth' && <ReconnectButton next={next} storage={storage} />}
        {facts
          ? <Link href="/company-facts" className={buttonVariants()}>{COPY.PROG_GO_TO_FACTS}</Link>
          : <Link href="/programs" className={buttonVariants()}>{COPY.PROG_GO_TO_PROGRAMS}</Link>}
      </div>
    </div>
  );
}
