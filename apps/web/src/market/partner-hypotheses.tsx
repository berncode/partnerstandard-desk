'use client';

// The linked partners are those whose link to this market names the hypothesis, and each opens its own page.
import { accountOf, type Hypothesis } from '@partner-desk/core';
import { EXAMPLE_MARKET } from '@partner-desk/method';
import { COPY, HYPOTHESIS_STATUS_LABELS } from '@partner-desk/copy';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState, type ReactNode } from 'react';
import { partnerHref } from '@/partner/partner-model';
import { Button } from '@/ui/button';
import { Chip } from '@/ui/chip';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { CheckAgain, ExampleLine, SavingName, Section } from '@/ui/pieces';
import { useThinkingEdit } from './change-log-offer';
import { HypothesisEditor } from './hypothesis-editor';
import { useMarket, useMarketAct } from './market-context';
import { linkedPartners } from './market-model';
import { StatusProposals } from './market-proposals';
import { NeedsAttentionHint } from './needs-attention';
import { SearchPrompt } from './search-prompt';

const STATUS_TONE = { draft: 'neutral', holds: 'brand', dropped: 'warn' } as const;

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{term}</dt>
      <dd className="mt-0.5 text-sm break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function Evidence({ text }: { text: string }) {
  return <span className={cn('mt-1 block text-xs', text ? 'text-ink-2' : 'text-ink-3')}>{text ? COPY.EVIDENCE_LINE(text) : COPY.NO_EVIDENCE}</span>;
}

const NotYet = ({ children }: { children: string }) => <span className="text-ink-3">{children}</span>;

function HypothesisCard({ hypothesis, editing, onEdit, onDone }: { hypothesis: Hypothesis; editing: boolean; onEdit: () => void; onDone: () => void }) {
  const { market, book, marketId, readOnly, attentionFor, partners } = useMarket();
  const act = useMarketAct();
  const headingId = useId();
  const linked = linkedPartners(book, marketId, hypothesis.id);
  const points = hypothesis.valuePointIds.flatMap((id) => market.valuePoints.filter((v) => v.id === id));
  const name = hypothesis.name || COPY.UNTITLED_HYPOTHESIS;

  return (
    <li>
      <article aria-labelledby={headingId} className="grid gap-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-[15px] font-semibold break-words">{name}</h3>
            <Chip tone={STATUS_TONE[hypothesis.status]}>{HYPOTHESIS_STATUS_LABELS[hypothesis.status]}</Chip>
            {hypothesis.checkAgain && !editing && (
              <CheckAgain what={name} readOnly={readOnly}
                onChecked={() => act({ kind: 'clearCheckAgain', target: { entity: 'hypothesis', id: hypothesis.id } }, { label: COPY.MARKED_CHECKED })} />
            )}
          </div>
          {!readOnly && !editing && <Button size="sm" aria-label={COPY.EDIT_NAMED(name)} onClick={onEdit}>{COPY.EDIT}</Button>}
        </div>
        {!editing && <NeedsAttentionHint messages={attentionFor('hypothesis', hypothesis.id)} />}
        <StatusProposals hypothesisId={hypothesis.id} />
        {editing ? (
          <HypothesisEditor hypothesisId={hypothesis.id} partnerIds={linked.map((p) => p.id)} onDone={onDone} />
        ) : (
          <dl className="grid gap-3 md:grid-cols-2">
            <Row term={COPY.THEIR_SIDE}>{hypothesis.theirSide || <NotYet>{COPY.NOT_WRITTEN}</NotYet>}<Evidence text={hypothesis.theirEvidence} /></Row>
            <Row term={COPY.OUR_SIDE}>{hypothesis.ourSide || <NotYet>{COPY.NOT_WRITTEN}</NotYet>}<Evidence text={hypothesis.ourEvidence} /></Row>
            <Row term={COPY.VALUE_POINTS}>
              {points.length > 0
                ? <ul className="list-disc space-y-0.5 pl-4">{points.map((v) => <li key={v.id}>{v.text}</li>)}</ul>
                : <NotYet>{COPY.NONE_PICKED}</NotYet>}
            </Row>
            <Row term={COPY.COMPANIES_LIKE}>{hypothesis.lookalike || <NotYet>{COPY.NOT_WRITTEN}</NotYet>}</Row>
            <Row term={COPY.LINKED_PARTNERS}>
              {linked.length > 0 ? (
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {linked.map((p) => {
                    const id = partners.savedIdFor(p.accountId);
                    const name = accountOf(book, p)?.company ?? '';
                    return (
                      <li key={p.id}>
                        {id === null ? <SavingName>{name}</SavingName> : (
                          <Link href={partnerHref(id, p.partnerType)}
                            className="rounded text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
                            {name}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <NotYet>{COPY.NO_LINKED_PARTNERS}</NotYet>}
            </Row>
          </dl>
        )}
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-sm text-ink-2">{COPY.HYPOTHESIS_SEARCH_TEXT}</p>
          <SearchPrompt hypothesisId={hypothesis.id} />
        </div>
      </article>
    </li>
  );
}

/** *Add hypothesis*: a name, then the editor opens. Escape closes. */
function AddHypothesis({ onAdded }: { onAdded: (id: string) => void }) {
  const edit = useThinkingEdit();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const refocus = useRef(false);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={() => setOpen(true)}
        ref={(el) => {
          if (el && refocus.current) {
            refocus.current = false;
            el.focus();
          }
        }}>
        <Plus className="h-4 w-4" aria-hidden />
        {COPY.ADD_HYPOTHESIS}
      </Button>
    );
  }
  const close = (fromKey: boolean) => {
    refocus.current = fromKey;
    setOpen(false);
    setName('');
    setError(null);
  };
  const add = () => {
    if (!name.trim()) return close(true);
    const outcome = edit({ kind: 'add', entity: 'hypothesis', values: { name: name.trim() } }, { entity: 'hypothesis' }, { label: COPY.HYPOTHESIS_ADDED });
    if (!outcome.ok || !outcome.entityId) return setError(outcome.ok ? COPY.HYPOTHESIS_NOT_ADDED : outcome.fieldErrors?.name ?? outcome.message);
    close(false);
    onAdded(outcome.entityId);
  };
  return (
    <form className="mt-3" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <input autoFocus aria-label={COPY.NEW_HYPOTHESIS} value={name} placeholder={COPY.HYPOTHESIS_NAME_PLACEHOLDER}
        aria-invalid={error ? true : undefined} aria-describedby={errorId}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') close(true); }}
        className={controlClass} />
      <p id={errorId} className={cn('mt-1 text-xs', error ? 'text-danger' : 'text-ink-3')}>{error ?? COPY.ENTER_TO_ADD}</p>
    </form>
  );
}

/** The Partner hypotheses tab: one card per hypothesis, with its linked partners. */
export function PartnerHypothesesTab() {
  const { market, readOnly, idFor } = useMarket();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId === null ? null : idFor(editingId);
  const example = EXAMPLE_MARKET.hypothesis;
  return (
    <Section title={COPY.TAB_HYPOTHESES} description={COPY.HYPOTHESES_TEXT}>
      {market.hypotheses.length > 0 ? (
        <ul className="grid gap-3">
          {market.hypotheses.map((h) => (
            <HypothesisCard key={h.id} hypothesis={h} editing={editing === h.id}
              onEdit={() => setEditingId(h.id)} onDone={() => setEditingId(null)} />
          ))}
        </ul>
      ) : (
        <div className="text-sm text-ink-3">
          <p>{COPY.HYPOTHESES_EMPTY}</p>
          {!readOnly && <ExampleLine text={`${example.name}. ${example.theirSide}`} />}
        </div>
      )}
      {!readOnly && <AddHypothesis onAdded={setEditingId} />}
    </Section>
  );
}
