'use client';

// A card's counts come from the Partner book. It shows no status chip and no last change: the listing carries neither,
// and a card does not read its market's file.
import { RECRUITMENT_STEPS, STEP_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { Archive, ArchiveRestore } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { marketArchive } from '@/app/(signed-in)/actions/markets';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/ui/dialog';
import type { MarketCounts } from './markets-model';
import { useCopy, useViewer } from '@/storage-context';

/** Archives or unarchives a market and refreshes the list; a refusal or a failure shows as a toast. Answers whether it worked. */
function useArchive(marketId: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = async (archived: boolean): Promise<boolean> => {
    setPending(true);
    try {
      const outcome = await marketArchive(marketId, archived);
      if (!outcome.ok) {
        toast.error(outcome.message);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast.error(COPY.ACTION_FAILED);
      return false;
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}

/** One market on the Markets screen: its name, its partners per step, the closed ones. `counts` is null when the book could not be read. */
export function MarketCard({ marketId, displayName, counts }: { marketId: string; displayName: string; counts: MarketCounts | null }) {
  return (
    <article aria-label={displayName} className="flex h-full min-w-0 flex-col rounded-xl border border-line bg-surface p-4">
      <h2 className="min-w-0 text-[15px] font-semibold break-words">
        <Link href={`/markets/${marketId}`} className="rounded outline-none hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand">
          {displayName}
        </Link>
      </h2>
      {counts && (
        <dl aria-label={COPY.PARTNERS_PER_STEP} className="mt-3 flex flex-wrap gap-1 text-center">
          {RECRUITMENT_STEPS.map((step) => (
            <Cell key={step} label={STEP_LABELS[step]} count={counts.steps[step]} />
          ))}
          <Cell label={COPY.SIGNED_COLUMN} count={counts.signed} />
        </dl>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-3">
        <p className="min-w-0 flex-1">{counts ? COPY.CLOSED_COUNT(counts.closed) : COPY.COUNTS_UNAVAILABLE}</p>
        <ArchiveMarket marketId={marketId} displayName={displayName} />
      </div>
    </article>
  );
}

function Cell({ label, count }: { label: string; count: number }) {
  return (
    // As wide as its longest word, so a label breaks only between words ("Discovery call"), never inside one.
    <div className="flex min-w-fit flex-1 flex-col-reverse justify-end rounded-md bg-surface-2/60 px-1.5 py-1.5">
      <dt className="mt-0.5 text-[11px] leading-tight text-ink-3">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{count}</dd>
    </div>
  );
}

/** Archive asks first: the market leaves this screen, while its file stays in the person's Drive. Not for a viewer. */
function ArchiveMarket(props: { marketId: string; displayName: string }) {
  // A company server's viewer can't archive a market: no button for it (owner, 2026-11-14).
  return useViewer() ? null : <AskThenArchive {...props} />;
}

function AskThenArchive({ marketId, displayName }: { marketId: string; displayName: string }) {
  const words = useCopy();
  const [open, setOpen] = useState(false);
  const { run, pending } = useArchive(marketId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={COPY.ARCHIVE_NAMED(displayName)}>
          <Archive className="h-4 w-4" aria-hidden />
          {COPY.ARCHIVE}
        </Button>
      </DialogTrigger>
      <DialogContent title={COPY.ARCHIVE_TITLE(displayName)} description={words.ARCHIVE_TEXT}>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" disabled={pending} aria-busy={pending} onClick={async () => { if (await run(true)) setOpen(false); }}>
            <Archive className="h-4 w-4" aria-hidden />
            {COPY.ARCHIVE}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Puts an archived market back on the Markets screen. A company server's viewer can't: no button (owner, 2026-11-14). */
export function UnarchiveButton(props: { marketId: string; displayName: string }) {
  return useViewer() ? null : <Unarchive {...props} />;
}

function Unarchive({ marketId, displayName }: { marketId: string; displayName: string }) {
  const { run, pending } = useArchive(marketId);
  return (
    <Button size="sm" aria-label={COPY.UNARCHIVE_NAMED(displayName)} aria-busy={pending} disabled={pending} onClick={() => { void run(false); }}>
      <ArchiveRestore className="h-4 w-4" aria-hidden />
      {COPY.UNARCHIVE}
    </Button>
  );
}
