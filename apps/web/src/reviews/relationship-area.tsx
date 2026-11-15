'use client';

// Area 5, the relationship (reviews spec 5.2, 5.4): how likely the partner would recommend working with us, 0 to 10 (the
// scorecard's health number), against its target of 8, and a note on how it is going.
import { COPY } from '@partner-desk/copy';
import { cn } from '@/ui/cn';
import { InlineText } from '@/maps/components/inline-text';
import { Section } from '@/maps/pieces';
import { useReview } from './review-context';

const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function RelationshipArea() {
  const { review, number, targetOf, setNumber, dispatch } = useReview();
  const score = number('recommend')?.actual ?? null;
  const target = targetOf('recommend');
  return (
    <Section title={COPY.REVIEW_AREA_RELATIONSHIP}>
      <div role="group" aria-label={COPY.REVIEW_RECOMMEND}>
        <p className="text-sm font-medium">
          {COPY.REVIEW_RECOMMEND}
          {target !== null && <span className="font-normal text-ink-3"> · {COPY.REVIEW_TARGET} {target}</span>}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SCALE.map((n) => (
            <button key={n} type="button" aria-pressed={score === n} onClick={() => setNumber('recommend', { actual: score === n ? null : n })}
              className={cn(
                'h-8 w-8 rounded-lg border text-sm font-semibold tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand',
                score === n ? 'border-brand-strong bg-brand-strong text-on-brand' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
              )}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-1 text-xs font-medium text-ink-3">{COPY.REVIEW_RELATIONSHIP_NOTE}</p>
        <InlineText value={review.relationshipNote} label={COPY.REVIEW_RELATIONSHIP_NOTE} field="relationshipNote" multiline placeholder={COPY.MAP_ADD_NOTE}
          className="text-sm"
          onCommit={(relationshipNote) => dispatch({ kind: 'update', entity: 'review', id: review.id, patch: { relationshipNote } }, { label: COPY.MAP_CHANGED.noteSaved })} />
      </div>
    </Section>
  );
}
