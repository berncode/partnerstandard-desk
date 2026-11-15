'use client';

// Google only: Archive goes through the `marketArchive` server action and then back to the markets, and Reconnect starts Google on the server.
import { COPY, copyFor } from '@partner-desk/copy';
import { Archive, FileWarning } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { marketArchive } from '@/app/(signed-in)/actions/markets';
import { continueWithGoogle } from '@/app/sign-in/actions';
import { Button, buttonVariants } from '@/ui/button';
import { canReconnectGoogle, type StorageKind } from '@/storage-kind';
import { useViewer } from '@/storage-context';

/** The heading for each problem, in the words of where the work lives (plan 13, task 12). */
const headings = (storage: StorageKind): Record<string, string> => ({
  file_not_found: COPY.PROBLEM_FILE_GONE,
  structure: COPY.PROBLEM_STRUCTURE,
  auth: COPY.PROBLEM_AUTH,
  unavailable: copyFor(storage).PROBLEM_UNAVAILABLE,
});

/** A market whose file can't be read: why, and what the person can do (Reconnect, Archive, back to the markets). */
export function MarketProblem({ marketId, failure, storage }: {
  marketId: string; failure: { error: string; message: string }; storage: StorageKind;
}) {
  const { error, message } = failure;
  // A company server's viewer can't archive a market: no button for it (owner, 2026-11-14).
  const viewer = useViewer();
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center">
      <FileWarning className="mx-auto h-10 w-10 text-warn" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">{headings(storage)[error] ?? COPY.PROBLEM_OTHER}</h1>
      <p className="mt-2 text-ink-2">{message}</p>
      {error === 'unavailable' && <p className="mt-1 text-sm text-ink-3">{COPY.PROBLEM_WAIT}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {error === 'auth' && canReconnectGoogle(storage) && (
          <form action={continueWithGoogle}>
            <input type="hidden" name="next" value={`/markets/${marketId}`} />
            <Button type="submit" variant="primary">{COPY.RECONNECT_BUTTON}</Button>
          </form>
        )}
        {error === 'file_not_found' && !viewer && <ArchiveButton marketId={marketId} />}
        <Link href="/markets" className={buttonVariants()}>{COPY.BACK_TO_MARKETS}</Link>
      </div>
    </div>
  );
}

/** Archives the market: it leaves the Markets screen. The file is never touched. */
function ArchiveButton({ marketId }: { marketId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button aria-busy={pending} disabled={pending}
      onClick={() => startTransition(async () => {
        try {
          const result = await marketArchive(marketId, true);
          if (!result.ok) return void toast.error(result.message);
          router.push('/markets');
        } catch {
          toast.error(COPY.ACTION_FAILED);
        }
      })}>
      <Archive className="h-4 w-4" aria-hidden />
      {COPY.ARCHIVE}
    </Button>
  );
}
