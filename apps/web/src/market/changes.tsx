'use client';

// The call a change names is in the Partner book. The words come from packages/copy and the example from packages/method.
import { CHANGE_ENTITIES, type Change, type ChangeEntity } from '@partner-desk/core';
import { EXAMPLE_MARKET } from '@partner-desk/method';
import { CHANGE_ENTITY_LABELS, COPY } from '@partner-desk/copy';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '@/partners/partners-model';
import { Button } from '@/ui/button';
import { Chip } from '@/ui/chip';
import { cn } from '@/ui/cn';
import { InlineText } from '@/ui/inline-text';
import { ExampleLine, Section } from '@/ui/pieces';
import { useMarket, useMarketAct } from './market-context';
import { callLabel, changesNewestFirst, changeSubject } from './market-model';
import { NeedsAttentionHint } from './needs-attention';

type Filter = ChangeEntity | 'all';

const FILTER_LABELS: Record<Filter, string> = { all: COPY.ALL, ...COPY.CHANGE_FILTERS };

const EXAMPLE = `${formatDate(EXAMPLE_MARKET.change.date)} · ${EXAMPLE_MARKET.change.about} · ${EXAMPLE_MARKET.change.what}`;

function ChangeItem({ change }: { change: Change }) {
  const { market, book, dispatch, readOnly, attentionFor } = useMarket();
  const act = useMarketAct();
  const subject = changeSubject(market, change);
  const call = change.callId === null ? undefined : book.calls.find((k) => k.id === change.callId);
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <time dateTime={change.date} className="font-medium text-ink-2">{formatDate(change.date)}</time>
            <Chip>{CHANGE_ENTITY_LABELS[change.entity]}</Chip>
            {subject && <span className="min-w-0 break-words">{subject}</span>}
          </p>
          <InlineText value={change.what} label={COPY.WHAT_CHANGED} field="what" multiline disabled={readOnly} className="mt-1.5 text-sm"
            onCommit={(what) => dispatch({ kind: 'update', entity: 'change', id: change.id, patch: { what } }, { label: COPY.CHANGE_UPDATED })} />
          {call && <p className="mt-1 text-xs text-ink-3">{COPY.AFTER_THE_CALL(callLabel(book, call))}</p>}
          <NeedsAttentionHint messages={attentionFor('change', change.id)} />
        </div>
        {!readOnly && (
          <Button variant="ghost" size="icon" aria-label={COPY.DELETE_CHANGE}
            onClick={() => act({ kind: 'delete', entity: 'change', id: change.id }, { label: COPY.CHANGE_DELETED })}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

/** The Changes tab: the change log, newest first, filterable by what it is about. */
export function ChangesTab() {
  const { market } = useMarket();
  const [filter, setFilter] = useState<Filter>('all');
  const shown = changesNewestFirst(market.changes).filter((change) => filter === 'all' || change.entity === filter);

  return (
    <Section title={COPY.TAB_CHANGES} description={COPY.CHANGES_TEXT}>
      {market.changes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-3">
          <p>{COPY.CHANGES_EMPTY}</p>
          <ExampleLine text={EXAMPLE} />
        </div>
      ) : (
        <>
          <div role="group" aria-label={COPY.SHOW} className="mb-3 flex flex-wrap gap-1">
            {(['all', ...CHANGE_ENTITIES] as const).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
                className={cn('rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-2 outline-none hover:border-ink-3 focus-visible:ring-2 focus-visible:ring-brand',
                  'aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-strong')}>
                {FILTER_LABELS[value]}
              </button>
            ))}
          </div>
          {shown.length === 0
            ? <p className="text-sm text-ink-3">{COPY.NO_CHANGES_ABOUT(FILTER_LABELS[filter].toLowerCase())}</p>
            : <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface empty:hidden">{shown.map((change) => <ChangeItem key={change.id} change={change} />)}</ol>}
        </>
      )}
    </Section>
  );
}
