'use client';

// The call notes are those of the partners whose link to this market names the hypothesis, from the Partner book; words from packages/copy.
import { HYPOTHESIS_STATUSES, type ApplyOutcome, type Hypothesis, type HypothesisStatus, type Market } from '@partner-desk/core';
import {
  EXAMPLE_MARKET,
  SENTENCE_TEMPLATES,
  TIPS,
} from '@partner-desk/method';
import {
  COPY,
  HYPOTHESIS_STATUS_LABELS,
  VALUE_KIND_LABELS,
  VALUE_STATE_LABELS,
} from '@partner-desk/copy';
import { useId, useState, type ReactNode } from 'react';
import { sayIfRefused } from '@/partner/partner-context';
import { partnerCalls } from '@/partner/partner-model';
import { Button } from '@/ui/button';
import { InlineText } from '@/ui/inline-text';
import { CheckAgain, ExampleLine } from '@/ui/pieces';
import { useThinkingEdit } from './change-log-offer';
import { useMarket, useMarketAct } from './market-context';
import { callLabel, callNotes, evidenceLine, toggleValuePoint, withEvidence, type CallNote } from './market-model';
import { NeedsAttentionHint } from './needs-attention';

type Side = 'their' | 'our';
type Update = (patch: Partial<Hypothesis>) => ApplyOutcome<Market>;
const SENTENCE_FIELD = { their: 'theirSide', our: 'ourSide' } as const;
const EVIDENCE_FIELD = { their: 'theirEvidence', our: 'ourEvidence' } as const;
const SIDE_LABEL: Record<Side, string> = { their: COPY.THEIR_SIDE, our: COPY.OUR_SIDE };

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</p>
      {children}
    </div>
  );
}

/** One of the two sentences, with its evidence. */
function Sentence({ side, hypothesis, update }: { side: Side; hypothesis: Hypothesis; update: Update }) {
  const { readOnly } = useMarket();
  const sentence = SENTENCE_FIELD[side];
  const evidence = EVIDENCE_FIELD[side];
  return (
    <Part title={SIDE_LABEL[side]}>
      <InlineText value={hypothesis[sentence]} label={SIDE_LABEL[side]} field={sentence} multiline disabled={readOnly}
        placeholder={SENTENCE_TEMPLATES[sentence]} className="text-sm" onCommit={(text) => update({ [sentence]: text })} />
      {!hypothesis[sentence] && !readOnly && <ExampleLine text={EXAMPLE_MARKET.hypothesis[sentence]} />}
      <InlineText value={hypothesis[evidence]} label={COPY.EVIDENCE_FOR_SIDE(side)} field={evidence} multiline disabled={readOnly}
        placeholder={COPY.EVIDENCE_WHICH_CALL} className="mt-1 text-xs text-ink-2"
        onCommit={(text) => update({ [evidence]: text })} />
    </Part>
  );
}

/** Up to four value points that matter most to these partners. A deleted one stays ticked until it is unticked. */
function ValuePoints({ hypothesis, update }: { hypothesis: Hypothesis; update: Update }) {
  const { market, readOnly } = useMarket();
  const [refused, setRefused] = useState<string | null>(null);
  const errorId = useId();
  const deleted = hypothesis.valuePointIds.filter((id) => !market.valuePoints.some((v) => v.id === id));
  const toggle = (id: string) => {
    const result = toggleValuePoint(hypothesis.valuePointIds, id);
    if (!result.ok) return setRefused(result.message);
    setRefused(null);
    sayIfRefused(update({ valuePointIds: result.ids }));
  };
  const box = (id: string, label: string, extra?: ReactNode) => (
    <li key={id} className="flex flex-wrap items-center gap-x-2">
      <label className="inline-flex min-w-0 items-start gap-2 text-sm">
        <input type="checkbox" checked={hypothesis.valuePointIds.includes(id)} disabled={readOnly} onChange={() => toggle(id)}
          aria-describedby={refused ? errorId : undefined} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-strong" />
        <span className="break-words">{label}</span>
      </label>
      {extra}
    </li>
  );
  return (
    <fieldset className="grid gap-1">
      <legend className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{COPY.VALUE_POINTS_MATTER}</legend>
      <p className="text-xs text-ink-3">{COPY.UP_TO_FOUR}</p>
      {market.valuePoints.length + deleted.length === 0
        ? <p className="text-sm text-ink-3">{COPY.NO_VALUE_POINTS_YET}</p>
        : (
          <ul className="mt-1 grid gap-1">
            {market.valuePoints.map((v) => box(v.id, v.text, (
              <span className="text-xs text-ink-3">{VALUE_KIND_LABELS[v.kind]} · {VALUE_STATE_LABELS[v.state]}</span>
            )))}
            {deleted.map((id) => box(id, COPY.DELETED_VALUE_POINT))}
          </ul>
        )}
      {refused && <p id={errorId} role="alert" className="text-xs text-danger">{refused}</p>}
    </fieldset>
  );
}

/** The call notes of the partners in view, each one a click away from becoming evidence. */
function CallNotes({ partnerIds, onUse }: { partnerIds: readonly string[]; onUse: (side: Side, note: CallNote) => void }) {
  const { book, readOnly } = useMarket();
  const [side, setSide] = useState<Side>('their');
  const headingId = useId();
  const calls = partnerIds.flatMap((id) => partnerCalls(book, id))
    .map((call) => ({ call, notes: callNotes(call) }))
    .filter(({ notes }) => notes.length > 0);
  return (
    <section aria-labelledby={headingId} className="grid content-start gap-3 rounded-xl bg-surface-2/60 p-3">
      <p id={headingId} className="text-sm font-semibold">{COPY.CALL_NOTES}</p>
      {!readOnly && calls.length > 0 && (
        <div role="radiogroup" aria-label={COPY.USE_AS_EVIDENCE_FOR} className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-xs text-ink-3">{COPY.USE_AS_EVIDENCE_FOR}</span>
          {(['their', 'our'] as const).map((s) => (
            <label key={s} className="inline-flex items-center gap-1.5">
              <input type="radio" name={headingId} checked={side === s} onChange={() => setSide(s)} className="h-4 w-4 accent-brand-strong" />
              {SIDE_LABEL[s]}
            </label>
          ))}
        </div>
      )}
      {calls.length === 0 && <p className="text-sm text-ink-3">{COPY.NO_CALL_NOTES}</p>}
      {calls.map(({ call, notes }) => (
        <div key={call.id} className="grid gap-2">
          <p className="text-xs font-semibold text-ink-2">{callLabel(book, call)}</p>
          <ul className="grid gap-2">
            {notes.map((note) => (
              <li key={note.key} className="rounded-lg border border-line bg-surface p-2 text-sm">
                <p className="text-xs font-semibold text-ink-3">{note.title}</p>
                <p className="break-words whitespace-pre-wrap">{note.text}</p>
                {!readOnly && (
                  <Button variant="ghost" size="sm" className="mt-1 -ml-2 h-7 text-xs" aria-label={COPY.USE_AS_EVIDENCE_NAMED(note.title)}
                    onClick={() => onUse(side, note)}>
                    {COPY.USE_AS_EVIDENCE}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * The partner hypothesis editor: the two sentences from their templates, each with evidence; the value points; the
 * "companies like this one" text; the status. Call notes of the linked partners sit alongside to pick evidence from.
 * Edits save at once and offer the change log.
 */
export function HypothesisEditor({ hypothesisId, partnerIds, onDone }: { hypothesisId: string; partnerIds: readonly string[]; onDone: () => void }) {
  const { market, readOnly, idFor, attentionFor } = useMarket();
  const act = useMarketAct();
  const edit = useThinkingEdit();
  // A hypothesis added a moment ago has a local id until its add is saved.
  const hypothesis = market.hypotheses.find((h) => h.id === idFor(hypothesisId));
  if (!hypothesis) {
    return (
      <section aria-label={COPY.HYPOTHESIS_EDITOR} className="grid gap-2">
        <p className="text-sm text-ink-3">{COPY.HYPOTHESIS_GONE}</p>
        <div><Button size="sm" onClick={onDone}>{COPY.DONE}</Button></div>
      </section>
    );
  }
  const update: Update = (patch) =>
    edit({ kind: 'update', entity: 'hypothesis', id: hypothesis.id, patch }, { entity: 'hypothesis', id: hypothesis.id }, { label: COPY.HYPOTHESIS_UPDATED });
  const addEvidence = (side: Side, note: CallNote) => {
    const field = EVIDENCE_FIELD[side];
    sayIfRefused(update({ [field]: withEvidence(hypothesis[field], evidenceLine(note.title, note.text)) }));
  };

  return (
    <section aria-label={COPY.HYPOTHESIS_EDITOR} className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 basis-56">
              <Part title={COPY.FIELD_NAME}>
                <InlineText value={hypothesis.name} label={COPY.FIELD_NAME} field="name" disabled={readOnly} className="text-sm font-semibold"
                  onCommit={(name) => update({ name })} />
              </Part>
            </div>
            <label className="grid gap-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">
              {COPY.STATUS}
              <select value={hypothesis.status} disabled={readOnly}
                onChange={(e) => sayIfRefused(update({ status: e.target.value as HypothesisStatus }))}
                className="h-9 rounded-lg border border-line bg-surface px-2 text-sm font-normal tracking-normal text-ink normal-case outline-none focus:border-brand focus:ring-2 focus:ring-brand/30">
                {HYPOTHESIS_STATUSES.map((s) => <option key={s} value={s}>{HYPOTHESIS_STATUS_LABELS[s]}</option>)}
              </select>
            </label>
          </div>
          {hypothesis.checkAgain && (
            <CheckAgain what={hypothesis.name} readOnly={readOnly}
              onChecked={() => act({ kind: 'clearCheckAgain', target: { entity: 'hypothesis', id: hypothesis.id } }, { label: COPY.MARKED_CHECKED })} />
          )}
          <NeedsAttentionHint messages={attentionFor('hypothesis', hypothesis.id)} />
          <p className="text-sm text-ink-2">{TIPS['partnerHypothesis.evidence']}</p>
          <Sentence side="their" hypothesis={hypothesis} update={update} />
          <Sentence side="our" hypothesis={hypothesis} update={update} />
          <ValuePoints hypothesis={hypothesis} update={update} />
          <Part title={COPY.COMPANIES_LIKE}>
            <InlineText value={hypothesis.lookalike} label={COPY.COMPANIES_LIKE} field="lookalike" multiline disabled={readOnly}
              placeholder={COPY.LOOKALIKE_PLACEHOLDER} className="text-sm" onCommit={(lookalike) => update({ lookalike })} />
            {!hypothesis.lookalike && !readOnly && <ExampleLine text={EXAMPLE_MARKET.hypothesis.lookalike} />}
          </Part>
        </div>
        <div className="min-w-0">
          <CallNotes partnerIds={partnerIds} onUse={addEvidence} />
        </div>
      </div>
      <div><Button variant="primary" size="sm" onClick={onDone}>{COPY.DONE}</Button></div>
    </section>
  );
}
