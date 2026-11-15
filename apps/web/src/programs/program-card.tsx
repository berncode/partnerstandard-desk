'use client';

// New for PartnerStandard Desk (owner, 2026-10-30): one program on the Programs page, in the look of a market's card.
import { COPY } from '@partner-desk/copy';
import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { RemoteOutcome } from '@/editor/remote';
import { Button } from '@/ui/button';
import { useCopyAndOpen } from '@/ui/use-copy-and-open';
import { useViewer } from '@/storage-context';
import type { CreateProgram } from './add-program';
import { DeleteProgram } from './delete-program';
import type { ProgramRow } from './links';
import { programPath } from './steps';

const linkClass = 'rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand';

export type RemoveProgramById = (input: { programId: string }) => Promise<RemoteOutcome<{ programId: string }>>;

/**
 * A program: its name (opening it), its partners per level and the markets that feed it, with Copy (a copy of the
 * same partner type, opened at once) and Delete (asks first, by the name shown here). Its buttons carry its name, as
 * a market card's do. A markets list that couldn't be read never shows as "none".
 */
export function ProgramCard({ row, create, remove }: { row: ProgramRow; create: CreateProgram; remove: RemoveProgramById }) {
  const router = useRouter();
  const { programId, title, partnerType, gone, levels, markets } = row;
  const { run: copy, busy } = useCopyAndOpen(() => create({ partnerType, from: { copyOf: programId } }), (made) => programPath(made.programId, 'why'));
  // Deleted: the card leaves at once, before the list is read again.
  const [deleted, setDeleted] = useState(false);
  // A company server's viewer can't copy or delete a program: no buttons for it (owner, 2026-11-14).
  const viewer = useViewer();

  if (deleted) return null;

  return (
    <article aria-label={title} className="flex h-full min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="min-w-0 text-[15px] font-semibold break-words">
        <Link href={programPath(programId, 'why')} className="rounded outline-none hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand">
          {title}
        </Link>
      </h2>
      <div className="grid gap-1 text-sm">
        <p className={levels ? 'font-medium' : 'text-ink-3'}>
          {levels ? levels.map((l) => COPY.PROG_LEVEL_COUNT(l.name, l.count)).join(' · ') : gone ? COPY.PROGRAM_NOT_FOUND : COPY.COUNTS_UNAVAILABLE}
        </p>
        {markets === null ? <p className="text-ink-3">{COPY.PROG_MARKETS_UNAVAILABLE}</p> : markets.length === 0 ? <p className="text-ink-3">{COPY.PROG_NO_MARKETS}</p> : (
          <p className="min-w-0 break-words">
            <span className="text-ink-3">{COPY.PROG_FED_BY}: </span>
            {markets.map((m, i) => (
              <span key={m.marketId}>
                <Link href={`/markets/${encodeURIComponent(m.marketId)}`} className={linkClass}>{m.displayName}</Link>
                {i < markets.length - 1 && ', '}
              </span>
            ))}
          </p>
        )}
      </div>
      {!viewer && <div className="mt-auto flex flex-wrap justify-end gap-2 pt-1">
        <Button size="sm" disabled={busy} aria-busy={busy || undefined} aria-label={COPY.PROG_COPY_NAMED(title)} onClick={copy}>
          <Copy className="h-4 w-4" aria-hidden />
          {COPY.PROG_COPY}
        </Button>
        <DeleteProgram
          size="sm"
          name={title}
          label={COPY.PROG_DELETE_NAMED(title)}
          disabled={busy}
          remove={() => remove({ programId })}
          onDeleted={() => {
            setDeleted(true);
            router.refresh();
          }}
        />
      </div>}
    </article>
  );
}
