'use client';

// New for PartnerStandard Desk (spec 6): one case on the Business cases page, in the look of a program's card
// (src/programs/program-card.tsx), with the same Copy (useCopyAndOpen) and Delete (DeleteDialog).
import { COPY } from '@partner-desk/copy';
import { Copy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { RemoteOutcome } from '@/editor/remote';
import { formatDate } from '@/partners/partners-model';
import { Button } from '@/ui/button';
import { DeleteDialog } from '@/ui/delete-dialog';
import { useCopyAndOpen } from '@/ui/use-copy-and-open';
import { casePath, type CaseCardRow } from './case-rows';
import { useCopy, useViewer } from '@/storage-context';

const linkClass = 'rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand';

export type CaseById = (input: { caseId: string }) => Promise<RemoteOutcome<{ caseId: string }>>;

/**
 * A case: its partner and type ("Acme as reseller"), its title (opening it), when it was made and a link to the
 * partner, with Copy (a case of the same partner type, opened at once) and Delete (asks first), as a program's card
 * has them. A partner type gone from Partners shows by its type and says so; when Partners couldn't be read, the card
 * shows by its type with no link and no claim about the type (the page says what went wrong).
 */
export function CaseCard({ row, copy, remove }: { row: CaseCardRow; copy: CaseById; remove: CaseById }) {
  const words = useCopy();
  const router = useRouter();
  const { caseId, title, heading, partner, typeGone, createdAt } = row;
  const { run: makeCopy, busy } = useCopyAndOpen(() => copy({ caseId }), (made) => casePath(made.caseId));
  const [deleted, setDeleted] = useState(false);
  // A company server's viewer can't copy or delete a case: no buttons for it (owner, 2026-11-14).
  const viewer = useViewer();

  if (deleted) return null;

  return (
    <article aria-label={heading} className="flex h-full min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="min-w-0 text-[15px] font-semibold break-words">{heading}</h2>
      <div className="grid gap-1 text-sm">
        <Link href={casePath(caseId)} className={`${linkClass} w-fit break-words`}>{title}</Link>
        <p className="text-ink-3">{COPY.CASE_MADE(formatDate(createdAt))}</p>
        {partner && <Link href={partner.href} className={`${linkClass} w-fit break-words`}>{COPY.CASE_GO_TO_PARTNER(partner.company)}</Link>}
        {typeGone && <p className="text-warn">{COPY.CASE_TYPE_GONE}</p>}
      </div>
      {!viewer && <div className="mt-auto flex flex-wrap justify-end gap-2 pt-1">
        <Button size="sm" disabled={busy} aria-busy={busy || undefined} aria-label={COPY.CASE_COPY_NAMED(title, heading)} onClick={makeCopy}>
          <Copy className="h-4 w-4" aria-hidden />
          {COPY.CASE_COPY}
        </Button>
        <DeleteDialog
          size="sm"
          action={COPY.CASE_DELETE}
          title={COPY.CASE_DELETE_TITLE(title)}
          text={words.CASE_DELETE_TEXT(title)}
          label={COPY.CASE_DELETE_NAMED(title, heading)}
          disabled={busy}
          remove={() => remove({ caseId })}
          onDeleted={() => {
            setDeleted(true);
            router.refresh();
          }}
        />
      </div>}
    </article>
  );
}
