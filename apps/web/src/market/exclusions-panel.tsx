'use client';

// The other markets come from the directory listing the page already has; one is read when chosen (`marketRead`), and its Exclusions
// this market lacks are added in batches of up to MAX_BATCH, each one write (`marketExclusionsImport`). Words from COPY.
import { MAX_BATCH, mergeExclusions, newId, safeHref, type Exclusion, type MarketChange } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Download, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { marketRead } from '@/app/(signed-in)/actions/markets';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { Dialog, DialogContent } from '@/ui/dialog';
import { useMarket, useMarketAct } from './market-context';

/** *Add company*: company, website and reason. Enter adds and keeps the form open for the next one. */
function AddExclusion({ onClose }: { onClose: () => void }) {
  const { dispatch } = useMarket();
  const empty = { company: '', website: '', reason: '' };
  const [draft, setDraft] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formId = useId();
  const set = (patch: Partial<typeof draft>) => { setDraft({ ...draft, ...patch }); setErrors({}); };

  const add = () => {
    const values = { company: draft.company.trim(), website: draft.website.trim(), reason: draft.reason.trim() };
    const outcome = dispatch({ kind: 'add', entity: 'exclusion', values }, { label: COPY.EXCLUSION_ADDED });
    if (!outcome.ok) return setErrors(outcome.fieldErrors ?? { company: outcome.message });
    setDraft(empty);
  };
  const field = (key: keyof typeof draft, label: string, placeholder?: string) => (
    <label className="grid gap-1 text-xs font-medium text-ink-3">
      {label}
      <input autoFocus={key === 'company'} value={draft[key]} placeholder={placeholder} className={controlClass}
        aria-invalid={errors[key] ? true : undefined} aria-describedby={errors[key] ? `${formId}-${key}` : undefined}
        onChange={(e) => set({ [key]: e.target.value })} />
      {errors[key] && <span id={`${formId}-${key}`} className="font-normal text-danger">{errors[key]}</span>}
    </label>
  );

  return (
    <form aria-label={COPY.NEW_EXCLUSION} className="grid gap-2 rounded-xl bg-surface-2/60 p-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
      {field('company', COPY.FIELD_COMPANY)}
      {field('website', COPY.FIELD_WEBSITE, 'https://')}
      {field('reason', COPY.FIELD_REASON, COPY.EXCLUSION_REASON_PLACEHOLDER)}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">{COPY.ADD}</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>{COPY.CANCEL}</Button>
      </div>
    </form>
  );
}

/** The changes in batches of at most MAX_BATCH, in order. */
const batchesOf = (changes: MarketChange[]): MarketChange[][] =>
  Array.from({ length: Math.ceil(changes.length / MAX_BATCH) }, (_, i) => changes.slice(i * MAX_BATCH, (i + 1) * MAX_BATCH));

/** *Import from another market*: pick one of the company's other markets and add the Exclusions this one doesn't have yet. */
function ImportFromMarket({ others, onClose }: { others: ReadonlyArray<{ marketId: string; displayName: string }>; onClose: () => void }) {
  const { market, applyMany } = useMarket();
  const [chosen, setChosen] = useState(others[0]?.marketId ?? '');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const selectId = useId();

  const run = async () => {
    if (!chosen) return;
    setImporting(true);
    setMessage(null);
    let source: Exclusion[];
    try {
      const read = await marketRead(chosen);
      if (!read.ok) {
        setImporting(false);
        return setMessage({ ok: false, text: read.message });
      }
      source = read.snapshot.value.exclusions;
    } catch {
      setImporting(false);
      return setMessage({ ok: false, text: COPY.ACTION_FAILED });
    }
    const changes = mergeExclusions(market, { ...market, exclusions: source }, newId);
    const already = source.length - changes.length;
    let added = 0;
    for (const batch of batchesOf(changes)) {
      if (!(await applyMany(batch)).ok) break;
      added += batch.length;
    }
    setImporting(false);
    if (added === changes.length) return setMessage({ ok: true, text: COPY.EXCLUSIONS_IMPORTED(added, already) });
    setMessage({ ok: false, text: added === 0 ? COPY.NOTHING_IMPORTED : COPY.PARTLY_IMPORTED(added, changes.length) });
  };

  return (
    <section aria-label={COPY.IMPORT_FROM_MARKET} className="grid gap-2 rounded-xl bg-surface-2/60 p-3">
      <p className="text-sm text-ink-2">{COPY.IMPORT_EXCLUSIONS_TEXT}</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label htmlFor={selectId} className="grid min-w-0 flex-1 basis-48 gap-1 text-xs font-medium text-ink-3">
          {COPY.FIELD_MARKET_NAME}
          <select id={selectId} value={chosen} disabled={importing} className={controlClass} onChange={(e) => setChosen(e.target.value)}>
            {others.map((m) => <option key={m.marketId} value={m.marketId}>{m.displayName}</option>)}
          </select>
        </label>
        <Button type="submit" variant="primary" size="sm" className="h-9" disabled={importing || !chosen}>
          {importing ? COPY.IMPORTING : COPY.IMPORT}
        </Button>
      </form>
      <p role="status" className={cn('text-sm', message?.ok === false ? 'text-danger' : 'text-ink-2')}>{message?.text}</p>
      <div><Button variant="ghost" size="sm" onClick={onClose}>{COPY.DONE}</Button></div>
    </section>
  );
}

function ExclusionRow({ exclusion }: { exclusion: Exclusion }) {
  const { readOnly } = useMarket();
  const act = useMarketAct();
  const href = safeHref(exclusion.website);
  return (
    <li className="border-t border-line py-2.5 first:border-t-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{exclusion.company}</p>
          {exclusion.website && (href
            ? <a href={href} target="_blank" rel="noopener noreferrer"
                className="rounded text-sm break-all text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">{exclusion.website}</a>
            : <p className="text-sm break-all text-ink-2">{exclusion.website}</p>)}
          {exclusion.reason && <p className="mt-0.5 text-sm break-words text-ink-3">{exclusion.reason}</p>}
        </div>
        {!readOnly && (
          <Button variant="ghost" size="icon" aria-label={COPY.REMOVE_NAMED(exclusion.company)}
            onClick={() => act({ kind: 'delete', entity: 'exclusion', id: exclusion.id }, { label: COPY.EXCLUSION_REMOVED })}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The Exclusions side panel: companies this market's search prompts and imports leave out (its own partners are left
 * out anyway). Add, remove, and *Import from another market* when the company has another open market.
 */
export function ExclusionsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { market, marketId, markets, readOnly } = useMarket();
  const [mode, setMode] = useState<'list' | 'add' | 'import'>('list');
  const others = markets.filter((m) => m.marketId !== marketId && !m.archived);
  const changeOpen = (next: boolean) => {
    if (!next) setMode('list');
    onOpenChange(next);
  };
  const { exclusions } = market;
  let tools: ReactNode = null;
  if (!readOnly && mode === 'list') {
    tools = (
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => setMode('add')}>
          <Plus className="h-4 w-4" aria-hidden />
          {COPY.ADD_COMPANY}
        </Button>
        {others.length > 0 && (
          <Button size="sm" onClick={() => setMode('import')}>
            <Download className="h-4 w-4" aria-hidden />
            {COPY.IMPORT_FROM_MARKET}
          </Button>
        )}
      </div>
    );
  } else if (!readOnly && mode === 'add') {
    tools = <div className="mt-4"><AddExclusion onClose={() => setMode('list')} /></div>;
  } else if (!readOnly && mode === 'import') {
    tools = <div className="mt-4"><ImportFromMarket others={others} onClose={() => setMode('list')} /></div>;
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent title={COPY.EXCLUSIONS} description={COPY.EXCLUSIONS_TEXT}
        className="top-0 right-0 left-auto h-dvh w-full max-w-md translate-x-0 translate-y-0 overflow-y-auto rounded-none rounded-l-2xl sm:w-[28rem]">
        {tools}
        {exclusions.length === 0
          ? <p className="mt-4 text-sm text-ink-3">{COPY.NO_EXCLUSIONS}</p>
          : <ul className="mt-4">{exclusions.map((x) => <ExclusionRow key={x.id} exclusion={x} />)}</ul>}
      </DialogContent>
    </Dialog>
  );
}
