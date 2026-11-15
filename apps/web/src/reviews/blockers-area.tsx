'use client';

// Area 4, enablement and blockers (reviews spec 5.2): named blockers, each with its side and a note ("named, not
// summarized"). One click turns a blocker into a commitment with its title and side.
import { ACTIVITY_SIDES, type ActivitySide, type ReviewItem } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { ArrowRight, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { SideBadge } from '@/maps/badges';
import { InlineText } from '@/maps/components/inline-text';
import { sideName } from '@/maps/format';
import { AddInline, PillSelect, Section } from '@/maps/pieces';
import { useReview } from './review-context';

export function BlockersArea() {
  const { held, items, addItem } = useReview();
  const blockers = items('blocker');
  return (
    <Section title={COPY.REVIEW_AREA_BLOCKERS} description={COPY.REVIEW_BLOCKERS_TEXT}>
      {blockers.length === 0 && <p className="text-sm text-ink-3">{COPY.REVIEW_NO_BLOCKERS}</p>}
      <ul className="divide-y divide-line">
        {blockers.map((b) => <Blocker key={b.id} item={b} />)}
      </ul>
      {!held && (
        <AddInline label={COPY.REVIEW_ADD_BLOCKER} placeholder={COPY.REVIEW_BLOCKER_PLACEHOLDER} field="title"
          onAdd={(title) => addItem('blocker', { title, side: 'partner' })} />
      )}
    </Section>
  );
}

function Blocker({ item }: { item: ReviewItem }) {
  const { names, held, setItem, addItem, dispatch } = useReview();
  return (
    <li data-testid={`blocker-${item.id}`} className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {held
            ? <p className="text-sm font-medium break-words">{item.title}</p>
            : <InlineText value={item.title} label={COPY.REVIEW_BLOCKER} field="title" placeholder={COPY.REVIEW_BLOCKER_PLACEHOLDER}
                className="text-sm font-medium" onCommit={(title) => setItem(item.id, { title })} />}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {held
              ? item.side && <SideBadge side={item.side} names={names} />
              : (
                <PillSelect label={COPY.REVIEW_SIDE_OF(item.title || COPY.REVIEW_BLOCKER)} value={item.side ?? ''} className="h-7 max-w-40"
                  options={[...(item.side === null ? [['', COPY.REVIEW_PICK_SIDE] as const] : []), ...ACTIVITY_SIDES.map((s) => [s, sideName(s, names)] as const)]}
                  onChange={(side) => setItem(item.id, { side: (side || null) as ActivitySide | null })} />
              )}
            {!held && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                onClick={() => addItem('commitment', { title: item.title, side: item.side })}>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                {COPY.REVIEW_MAKE_COMMITMENT}
              </Button>
            )}
          </div>
          <div className="mt-1 text-sm">
            <InlineText value={item.note} label={COPY.REVIEW_NOTE_OF(item.title || COPY.REVIEW_BLOCKER)} field="note" placeholder={COPY.MAP_ADD_NOTE}
              className="text-ink-2" onCommit={(note) => setItem(item.id, { note })} />
          </div>
        </div>
        {!held && (
          <Button variant="ghost" size="icon" aria-label={COPY.REVIEW_DELETE_BLOCKER}
            onClick={() => dispatch({ kind: 'delete', entity: 'reviewItem', id: item.id }, { label: COPY.DELETED })}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}
