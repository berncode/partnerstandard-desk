'use client';

// New for PartnerStandard Desk (spec 5.1): the open partner type's business cases, newest first, and New case. A closed or
// exited partner type keeps its cases and still offers New case.
import { PARTNER_TYPE_LABELS, STAGE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { caseMoney, casePath, type CaseAreaRow } from '@/cases/case-rows';
import { NewCaseForm, useMakeCase, type CreateCase } from '@/cases/new-case-form';
import type { RemoteOutcome } from '@/editor/remote';
import { formatDate } from '@/partners/partners-model';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { Section } from '@/ui/pieces';
import { useViewer } from '@/storage-context';
import { usePartner } from './partner-context';

export type LoadCaseRows = (input: { partnerId: string }) => Promise<RemoteOutcome<{ rows: CaseAreaRow[] }>>;

type Rows = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; rows: CaseAreaRow[] };

const linkClass = 'rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand';

/**
 * The Business case area. Its rows are read when the tab opens, and again whenever the page shows again (Next keeps
 * it, hidden, while the person is on a case). New case makes the case at once and opens it; when the person must pick
 * the program, a dialog asks for it first.
 */
export function CaseArea({ load, create }: { load: LoadCaseRows; create: CreateCase }) {
  const { account, partner, programs, readOnly } = usePartner();
  const partnerId = partner.id;
  // The rows as last read, and for which partner type: another type's rows show as loading until its own come.
  const [read, setRead] = useState<{ partnerId: string; rows: Rows } | null>(null);
  const rows: Rows = read?.partnerId === partnerId ? read.rows : { status: 'loading' };
  const [picking, setPicking] = useState(false);
  const { make, pending } = useMakeCase(create);
  // A company server's viewer can't make a case: no button (owner, 2026-11-14). Read only after a failed save, it stays, off.
  const viewer = useViewer();

  useEffect(() => {
    let live = true;
    const show = (next: Rows) => { if (live) setRead({ partnerId, rows: next }); };
    load({ partnerId })
      .then((answer) => show(answer.ok ? { status: 'ready', rows: answer.rows } : { status: 'failed', message: answer.message }))
      .catch(() => show({ status: 'failed', message: COPY.ACTION_FAILED }));
    return () => { live = false; };
  }, [load, partnerId]);

  const newCase = () => make({ partnerId }, ({ message, askProgram }) => {
    if (askProgram) setPicking(true);
    else toast.error(message);
  });

  const option = { partnerId, label: COPY.PARTNER_AS_TYPE(account.company, PARTNER_TYPE_LABELS[partner.partnerType]), partnerType: partner.partnerType };

  return (
    <Section title={COPY.CASE_AREA_TITLE} description={COPY.CASE_AREA_TEXT}
      actions={viewer ? undefined : (
        <Button variant="primary" size="sm" disabled={readOnly || pending} aria-busy={pending || undefined} onClick={newCase}>
          <Plus className="h-4 w-4" aria-hidden />
          {COPY.NEW_CASE}
        </Button>
      )}>
      {rows.status === 'loading' && <p aria-busy="true" className="text-sm text-ink-3">{COPY.CASE_AREA_LOADING}</p>}
      {rows.status === 'failed' && <p role="alert" className="text-sm text-danger">{rows.message}</p>}
      {rows.status === 'ready' && rows.rows.length === 0 && <p className="text-sm text-ink-3">{COPY.CASE_AREA_EMPTY}</p>}
      {rows.status === 'ready' && rows.rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.rows.map((row) => <CaseRow key={row.caseId} row={row} partner={account.company} />)}
        </ul>
      )}
      <Dialog open={picking} onOpenChange={setPicking}>
        {picking && (
          <DialogContent title={COPY.NEW_CASE} description={option.label}>
            <div className="mt-4">
              <NewCaseForm partners={[option]} programs={programs} fixed startAsking create={create} />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Section>
  );
}

/** One case: its title (opening it), when it was made and the stage then, and its two numbers over five years. */
function CaseRow({ row, partner }: { row: CaseAreaRow; partner: string }) {
  const { numbers } = row;
  const made = formatDate(row.createdAt);
  return (
    <li className="grid min-w-0 gap-0.5 py-3 first:pt-0 last:pb-0">
      <Link href={casePath(row.caseId)} className={`${linkClass} w-fit break-words`}>{row.title}</Link>
      <p className="text-xs text-ink-3">{numbers ? COPY.CASE_MADE_IN_STAGE(made, STAGE_LABELS[numbers.stageWhenMade]) : COPY.CASE_MADE(made)}</p>
      <p className="text-sm break-words text-ink-2">
        {numbers
          ? COPY.CASE_NUMBERS(partner, caseMoney(numbers.earnings, numbers.currency), caseMoney(numbers.net, numbers.currency))
          : COPY.CASE_NUMBERS_UNAVAILABLE}
      </p>
    </li>
  );
}
