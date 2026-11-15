'use client';

// Area 2, is the partner hypothesis still valid? (reviews spec 5.2): each linked partner hypothesis, read-only, with one
// answer and a note; with none linked, the question is about "Why it fits". "Changed" links to the hypothesis on its
// market: the review never changes it.
import { HYPOTHESIS_ANSWERS, type HypothesisAnswer, type ReviewItem } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { cn } from '@/ui/cn';
import { InlineText } from '@/maps/components/inline-text';
import { Section } from '@/maps/pieces';
import { marketPath } from '@/market/market-model';
import { useReview } from './review-context';

export function HypothesisArea() {
  const { read, items } = useReview();
  const questions = items('hypothesis');
  return (
    <Section title={COPY.REVIEW_AREA_HYPOTHESIS}>
      {read.hypothesesIncomplete && (
        <p role="note" className="mb-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">{COPY.REVIEW_HYPOTHESES_INCOMPLETE}</p>
      )}
      <ul className="space-y-5">
        {questions.map((q) => <Question key={q.id} item={q} />)}
      </ul>
    </Section>
  );
}

function Question({ item }: { item: ReviewItem }) {
  const { read, held, setItem } = useReview();
  const hypothesis = item.refId ? read.hypotheses.find((h) => h.id === item.refId) ?? null : null;
  const kicker = item.refId === null ? COPY.REVIEW_WHY_IT_FITS : hypothesis ? COPY.REVIEW_FROM_MARKET(hypothesis.marketName) : null;
  const question = item.title || COPY.REVIEW_WHY_IT_FITS;
  const answer = (value: HypothesisAnswer) => setItem(item.id, { answer: item.answer === value ? null : value });
  return (
    <li className="min-w-0">
      {kicker && <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{kicker}</p>}
      <p className="mt-0.5 text-sm font-medium break-words">{item.title}</p>
      <div role="group" aria-label={COPY.REVIEW_ANSWER_OF(question)} className="mt-2 flex flex-wrap items-center gap-2">
        {HYPOTHESIS_ANSWERS.map((value) => (
          <button key={value} type="button" aria-pressed={item.answer === value} disabled={held} onClick={() => answer(value)}
            className={cn(
              'h-8 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-70',
              item.answer === value ? 'border-brand-strong bg-brand-strong text-on-brand' : 'border-line bg-surface text-ink-2 hover:border-ink-3',
            )}>
            {COPY.REVIEW_ANSWER_LABELS[value]}
          </button>
        ))}
        {item.answer === 'changed' && hypothesis && (
          <Link href={marketPath(hypothesis.marketId, 'hypotheses')} className="text-xs font-medium text-brand-strong underline-offset-2 hover:underline">
            {COPY.REVIEW_EDIT_ON_MARKET}
          </Link>
        )}
      </div>
      <div className="mt-2 text-sm">
        <InlineText value={item.note} label={COPY.REVIEW_NOTE_OF(question)} field="note" multiline placeholder={COPY.MAP_ADD_NOTE}
          className="text-ink-2" onCommit={(note) => setItem(item.id, { note })} />
      </div>
    </li>
  );
}
