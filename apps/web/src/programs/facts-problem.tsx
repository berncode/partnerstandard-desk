import { COPY, copyFor } from '@partner-desk/copy';
import { FileWarning } from 'lucide-react';
import Link from 'next/link';
import { ReconnectButton } from '@/problems/reconnect';
import { buttonVariants } from '@/ui/button';
import type { StorageKind } from '@/storage-kind';

/** The heading for each problem, in the words of where the work lives (plan 13, task 12). */
const headings = (storage: StorageKind): Record<string, string> => ({
  file_not_found: COPY.FACTS_PROBLEM_GONE,
  structure: COPY.FACTS_PROBLEM_STRUCTURE,
  auth: COPY.PROBLEM_AUTH,
  unavailable: copyFor(storage).PROBLEM_UNAVAILABLE,
});

/**
 * Company facts can't be read: why (the store's message names what to fix in the sheet), and what the person can do.
 * An expired Google sign-in offers Reconnect Google. In the look of the market's problem page (MarketProblem).
 */
export function FactsProblem({ failure, next, storage }: {
  failure: { error: string; message: string }; next: string; storage: StorageKind;
}) {
  const { error, message } = failure;
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center">
      <FileWarning className="mx-auto h-10 w-10 text-warn" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">{headings(storage)[error] ?? COPY.FACTS_PROBLEM_OTHER}</h1>
      <p className="mt-2 break-words text-ink-2">{message}</p>
      {error === 'unavailable' && <p className="mt-1 text-sm text-ink-3">{COPY.PROBLEM_WAIT}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {error === 'auth' && <ReconnectButton next={next} storage={storage} />}
        <Link href="/partners" className={buttonVariants()}>{COPY.GO_TO_PARTNERS}</Link>
      </div>
    </div>
  );
}
