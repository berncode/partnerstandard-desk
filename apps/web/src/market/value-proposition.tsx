'use client';

// Words from packages/copy and examples from packages/method. The Partner Business Calculator link is left out until that tool is live.
import { VALUE_KINDS, VALUE_STATES, type ValueKind, type ValuePoint } from '@partner-desk/core';
import { EXAMPLE_MARKET, LINKS } from '@partner-desk/method';
import { COPY, VALUE_KIND_LABELS, VALUE_STATE_LABELS } from '@partner-desk/copy';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { sayIfRefused } from '@/partner/partner-context';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { InlineText } from '@/ui/inline-text';
import { CheckAgain, ExampleLine, LearnMore, Section } from '@/ui/pieces';
import { useThinkingEdit } from './change-log-offer';
import { useMarket, useMarketAct } from './market-context';

const STATE_STYLE = {
  assumption: 'aria-pressed:border-info aria-pressed:bg-info-soft aria-pressed:text-info',
  confirmed: 'aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-strong',
  dropped: 'aria-pressed:border-ink-3 aria-pressed:bg-surface-2 aria-pressed:text-ink-2',
} as const;

function ValuePointItem({ point }: { point: ValuePoint }) {
  const { readOnly } = useMarket();
  const act = useMarketAct();
  const edit = useThinkingEdit();
  const about = { entity: 'value_point', id: point.id } as const;
  const update = (patch: Partial<ValuePoint>) =>
    edit({ kind: 'update', entity: 'valuePoint', id: point.id, patch }, about, { label: COPY.VALUE_POINT_UPDATED });

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <InlineText value={point.text} label={COPY.VALUE_POINT} field="text" multiline disabled={readOnly}
            className={cn('text-sm font-medium', point.state === 'dropped' && 'text-ink-3 line-through')}
            onCommit={(text) => update({ text })} />
          <div role="group" aria-label={COPY.VALUE_STATE} className="mt-2 flex flex-wrap items-center gap-1">
            {VALUE_STATES.map((state) => (
              <button key={state} type="button" aria-pressed={point.state === state} disabled={readOnly}
                onClick={() => { if (point.state !== state) sayIfRefused(update({ state })); }}
                className={cn('rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold text-ink-3 outline-none hover:border-ink-3 focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none',
                  STATE_STYLE[state])}>
                {VALUE_STATE_LABELS[state]}
              </button>
            ))}
            {point.checkAgain && (
              <CheckAgain what={point.text} readOnly={readOnly}
                onChecked={() => act({ kind: 'clearCheckAgain', target: { entity: 'valuePoint', id: point.id } }, { label: COPY.MARKED_CHECKED })} />
            )}
          </div>
          <InlineText value={point.evidence} label={COPY.EVIDENCE} field="evidence" multiline disabled={readOnly}
            placeholder={COPY.VALUE_EVIDENCE_PLACEHOLDER} className="mt-2 text-xs text-ink-2"
            onCommit={(evidence) => update({ evidence })} />
        </div>
        {!readOnly && (
          <Button variant="ghost" size="icon" aria-label={COPY.DELETE_VALUE_POINT}
            onClick={() => sayIfRefused(edit({ kind: 'delete', entity: 'valuePoint', id: point.id }, about, { label: COPY.VALUE_POINT_DELETED }))}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

/** *Add value point* opens a one-line input. Enter adds and keeps it open for the next one; Escape closes. */
function AddValuePoint({ kind }: { kind: ValueKind }) {
  const edit = useThinkingEdit();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const refocus = useRef(false);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setOpen(true)}
        ref={(el) => {
          if (el && refocus.current) {
            refocus.current = false;
            el.focus();
          }
        }}>
        <Plus className="h-4 w-4" aria-hidden />
        {COPY.ADD_VALUE_POINT}
      </Button>
    );
  }
  const close = () => {
    refocus.current = true;
    setOpen(false);
    setText('');
    setError(null);
  };
  const add = () => {
    if (!text.trim()) return close();
    const outcome = edit({ kind: 'add', entity: 'valuePoint', values: { kind, text: text.trim() } }, { entity: 'value_point' }, { label: COPY.VALUE_POINT_ADDED });
    if (!outcome.ok) return setError(outcome.fieldErrors?.text ?? outcome.message);
    setText('');
    setError(null);
  };
  return (
    <form className="mt-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <input autoFocus aria-label={COPY.NEW_VALUE_POINT} value={text} placeholder={COPY.VALUE_POINT_PLACEHOLDER}
        aria-invalid={error ? true : undefined} aria-describedby={errorId}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
        className={controlClass} />
      <p id={errorId} className={cn('mt-1 text-xs', error ? 'text-danger' : 'text-ink-3')}>{error ?? COPY.ENTER_TO_ADD}</p>
    </form>
  );
}

function KindGroup({ kind }: { kind: ValueKind }) {
  const { market, readOnly } = useMarket();
  const id = useId();
  const points = market.valuePoints.filter((v) => v.kind === kind);
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-xl bg-surface-2/60 p-3">
      <h3 id={id} className="text-sm font-semibold">{VALUE_KIND_LABELS[kind]}</h3>
      <p className="mt-0.5 text-xs text-ink-3">{COPY.VALUE_KIND_HELP[kind]}</p>
      {points.length > 0 && <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface empty:hidden">{points.map((point) => <ValuePointItem key={point.id} point={point} />)}</ul>}
      {points.length === 0 && (readOnly
        ? <p className="mt-3 text-sm text-ink-3">{COPY.NO_VALUE_POINTS}</p>
        : <ExampleLine className="mt-3" text={EXAMPLE_MARKET.valuePoints[kind]} />)}
      {!readOnly && <AddValuePoint kind={kind} />}
    </section>
  );
}

/** The Value proposition tab: value points by kind, with their state. */
export function ValuePropositionTab() {
  return (
    <Section title={COPY.TAB_VALUE} description={COPY.VALUE_TEXT}
      actions={<LearnMore href={LINKS.partnerValueProposition!}>{COPY.VALUE_LEARN_MORE}</LearnMore>}>
      <div className="grid gap-3 md:grid-cols-2">
        {VALUE_KINDS.map((kind) => <KindGroup key={kind} kind={kind} />)}
      </div>
    </Section>
  );
}
