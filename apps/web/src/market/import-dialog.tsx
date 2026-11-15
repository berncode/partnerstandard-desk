'use client';

// The preview checks the Partner book as the page holds it now (checked again whenever the book changes), and the ticked
// rows go to `importPartners` in one batch, all or nothing, sent once: a refusal keeps the preview open and says why, with
// no Retry. Words from COPY. An agent's new partners proposal opens on the same preview (agent proposals spec 10.3).
import {
  canTick, companyItems, parseTable, previewImport, statusRows, type ParsedTable, type PartnerBook, type PartnerChange, type PreviewRow,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useId, useMemo, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { today } from '@/partners/partners-model';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { Dialog, DialogContent } from '@/ui/dialog';
import { DisabledReason } from '@/ui/pieces';
import { changesFor, importCounts, MAX_FILE_BYTES, refusalLines, tooManyForOneImport, withTicks } from './import-model';
import type { RemoteFailure } from '@/editor/remote';
import { noteAnswered } from '@/proposals/waiting-store';
import { useMarket } from './market-context';
import type { CompaniesProposal } from './market-proposals';
import { PreviewTable } from './preview-table';

/** "Results for" the market hypothesis's prompt. */
const MARKET_HYPOTHESIS = '';

/** The table the person gave, and the rows they ticked or unticked themselves (by row). */
interface Pasted { table: ParsedTable; ticks: Record<number, boolean> }

/**
 * What importing from a proposal answers, besides the import: each company's row Accepted when it goes in, Rejected
 * when not, so the card says "Accepted 9 of 12" at once. Row i of the preview is the proposal's company i.
 */
function proposalAnswers(book: PartnerBook, proposalId: string, rows: readonly PreviewRow[], ticked: readonly number[], now: string): PartnerChange[] {
  const own = book.proposalItems.filter((i) => i.proposalId === proposalId);
  const companies = companyItems(own);
  const yes = new Set(ticked.map((i) => companies[i]?.id));
  const waiting = own.filter((i) => i.status === 'waiting');
  return rows.length === companies.length
    ? [...statusRows(waiting.filter((i) => yes.has(i.id)), 'accepted', now), ...statusRows(waiting.filter((i) => !yes.has(i.id)), 'rejected', now)]
    : [];
}

/**
 * *Import AI results*: a pasted table or an uploaded CSV, a preview with tick boxes and what the duplicate check found,
 * then one button that says what it does. Nothing is added without the preview, and nothing is added in part.
 * With `proposal` (an agent's new partners, spec 10.3) it opens on the preview of those companies, for the proposal's
 * hypothesis; each company keeps the Source detail the agent gave. Importing accepts the ticked ones and rejects the
 * rest, in one write; closing changes nothing. Mount it with the proposal, so it starts on it.
 */
export function ImportDialog({ open, onOpenChange, proposal }: {
  open: boolean; onOpenChange: (open: boolean) => void; proposal?: CompaniesProposal;
}) {
  const { market, book, marketId, partners, importUnknown, markImportUnknown, proposals } = useMarket();
  const [text, setText] = useState('');
  const [hypothesisId, setHypothesisId] = useState(proposal?.hypothesisId ?? MARKET_HYPOTHESIS);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState<Pasted | null>(() => (proposal ? { table: proposal.table, ticks: {} } : null));
  /** While adding: the book the preview was checked against (the page's book then also shows the rows being added). */
  const [addingFrom, setAddingFrom] = useState<PartnerBook | null>(null);
  const adding = addingFrom !== null;
  const [refusal, setRefusal] = useState<string[] | null>(null);
  const textId = useId();
  const fileId = useId();
  const errorId = useId();
  const tooManyId = useId();
  const nothingTickedId = useId();

  const hypothesis = market.hypotheses.find((h) => h.id === hypothesisId);
  const source = {
    marketId, hypothesisId: hypothesis?.id ?? null,
    hypothesisName: hypothesis ? hypothesis.name.trim() || COPY.UNTITLED_HYPOTHESIS : '', date: today(),
  };
  // The duplicate check runs on the book as it is now, so a partner that got in meanwhile is never added again.
  const checkedBook = addingFrom ?? book;
  const preview = useMemo(
    () => pasted && withTicks(previewImport({ book: checkedBook, market, table: pasted.table }), pasted.ticks),
    [pasted, checkedBook, market],
  );
  const changes = preview ? changesFor(preview.rows, source, market) : [];
  const counts = preview ? importCounts(preview.rows) : { added: 0, linked: 0 };
  const ticked = counts.added + counts.linked;
  const tooMany = tooManyForOneImport(changes);
  const nothingTicked = ticked === 0 && !adding;

  const reset = () => {
    setText('');
    setError(null);
    setPasted(proposal ? { table: proposal.table, ticks: {} } : null);
    setRefusal(null);
  };
  const changeOpen = (next: boolean) => {
    if (adding) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const showPreview = (input: string) => {
    const parsed = parseTable(input);
    if (!parsed.ok) {
      setPasted(null);
      return setError(parsed.message);
    }
    setError(null);
    setRefusal(null);
    setPasted({ table: parsed.table, ticks: {} });
  };

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setPasted(null);
      return setError(COPY.FILE_TOO_BIG);
    }
    let content: string;
    try {
      content = await file.text();
    } catch {
      setPasted(null);
      return setError(COPY.FILE_UNREADABLE);
    }
    setText(content);
    showPreview(content);
  };

  const toggle = (index: number, selected: boolean) => {
    setRefusal(null);
    setPasted((p) => p && { ...p, ticks: { ...p.ticks, [index]: selected } });
  };

  /** The proposal's accept: the ticked rows' import and every company's answer, saved by the proposal's id. */
  const accepting = async (from: CompaniesProposal) => {
    const rows = preview?.rows ?? [];
    const ticked = rows.flatMap((row, i) => (row.selected && canTick(row) ? [i] : []));
    const heard: { failure: RemoteFailure | null } = { failure: null };
    const outcome = await partners.applyMany(
      [...changes, ...proposalAnswers(book, from.proposalId, rows, ticked, new Date().toISOString())],
      { accept: { proposalId: from.proposalId, ticked, onRefused: (failure) => { heard.failure = failure; } } },
      { quiet: true },
    );
    // Saved: the sidebar's count goes down. Refused: the page reads again, so the preview checks the book as it is now;
    // Google gone shows Reconnect Google.
    if (outcome.ok) noteAnswered(from.proposalId);
    else if (heard.failure && heard.failure.error !== 'auth') proposals?.refused(heard.failure);
    return outcome;
  };

  const add = async () => {
    if (changes.length === 0 || tooMany || importUnknown) return;
    const before = book;
    setAddingFrom(before);
    setRefusal(null);
    // Quiet: this dialog says why it failed, and the editor offers no Retry, so the import is never sent twice.
    const outcome = proposal ? await accepting(proposal) : await partners.applyMany(changes, { marketId }, { quiet: true });
    setAddingFrom(null);
    if (!outcome.ok) {
      // No clear answer: some of it may be in the book, so nothing more is offered until a reload shows what is there.
      if (outcome.unknown) return markImportUnknown();
      // The server worked the accept out again: which company it stopped at isn't one of these changes.
      return setRefusal(refusalLines(changes, proposal ? { ...(outcome.message ? { message: outcome.message } : {}) } : outcome, before));
    }
    toast(COPY.IMPORTED(counts.added, counts.linked));
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent title={proposal ? COPY.PROPOSAL_REVIEW_COMPANIES : COPY.IMPORT_AI_RESULTS}
        description={proposal ? `${COPY.PROPOSAL_BY(COPY.DESK_AGENT)}. ${COPY.PROPOSAL_TICK_HINT}` : COPY.IMPORT_AI_TEXT}
        className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto">
        {importUnknown && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
            <p className="min-w-0 flex-1 basis-60">{COPY.IMPORT_OUTCOME_UNKNOWN}</p>
            <Button size="sm" onClick={() => window.location.reload()}>{COPY.RELOAD}</Button>
          </div>
        )}
        {preview === null ? (
          <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); showPreview(text); }}>
            <label className="grid gap-1 text-xs font-medium text-ink-3">
              {COPY.RESULTS_FOR}
              <select value={hypothesisId} onChange={(e) => setHypothesisId(e.target.value)} className={controlClass}>
                <option value={MARKET_HYPOTHESIS}>{COPY.RESULTS_FOR_MARKET}</option>
                {market.hypotheses.map((h) => <option key={h.id} value={h.id}>{h.name || COPY.UNTITLED_HYPOTHESIS}</option>)}
              </select>
            </label>
            <div className="grid gap-1">
              <label htmlFor={textId} className="text-xs font-medium text-ink-3">{COPY.PASTE_TABLE}</label>
              <textarea id={textId} value={text} rows={10} spellCheck={false} className={cn(controlClass, 'h-auto py-2 font-mono text-xs')}
                aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
                placeholder={COPY.PASTE_TABLE_PLACEHOLDER} onChange={(e) => { setText(e.target.value); setError(null); }} />
            </div>
            <div className="grid gap-1">
              <label htmlFor={fileId} className="text-xs font-medium text-ink-3">{COPY.UPLOAD_CSV}</label>
              <input id={fileId} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                onChange={(e) => void readFile(e)}
                className="min-w-0 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink" />
            </div>
            {error && <p id={errorId} role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => changeOpen(false)}>{COPY.CANCEL}</Button>
              <Button type="submit" variant="primary" size="sm" disabled={!text.trim()}>{COPY.SHOW_PREVIEW}</Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 grid gap-3">
            <p role="status" className="text-sm text-ink-2">
              {COPY.TICKED(ticked, preview.rows.length)}
              {preview.droppedNoName > 0 && ` ${COPY.NO_NAME_LEFT_OUT(preview.droppedNoName)}`}
            </p>
            <PreviewTable rows={preview.rows} partnerType={market.info.partnerType} onToggle={toggle} disabled={adding} />
            {refusal && (
              <div role="alert" className="grid gap-1 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                {refusal.map((line) => <p key={line}>{line}</p>)}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {adding && <span className="mr-auto text-sm text-ink-3">{COPY.ADDING_KEEP_OPEN}</span>}
              {proposal ? (
                <Button variant="ghost" size="sm" disabled={adding} onClick={() => changeOpen(false)}>{COPY.CANCEL}</Button>
              ) : (
                <Button variant="ghost" size="sm" disabled={adding} onClick={() => { setPasted(null); setRefusal(null); }}>{COPY.BACK}</Button>
              )}
              <Button variant="primary" size="sm" disabled={adding || ticked === 0 || tooMany || importUnknown}
                aria-describedby={tooMany ? tooManyId : nothingTicked ? nothingTickedId : undefined} onClick={() => void add()}>
                {COPY.ADD_IMPORTED(counts.added, counts.linked)}
              </Button>
            </div>
            {nothingTicked && <div className="text-right"><DisabledReason id={nothingTickedId}>{COPY.IMPORT_NOTHING_TICKED}</DisabledReason></div>}
            {tooMany && <div className="text-right"><DisabledReason id={tooManyId}>{COPY.IMPORT_TOO_MANY}</DisabledReason></div>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
