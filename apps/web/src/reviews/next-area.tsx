'use client';

// Area 3, next quarter (reviews spec 5.2): a target per scorecard number for the next review to check, and the
// commitments, each with a side, an owner from the MAP's people, a due date and optionally a milestone. Closing the
// review turns each one into a MAP activity; after that it shows "Now in the MAP" and is edited there.
import { ACTIVITY_SIDES, type ActivitySide, type MapApplyOutcome, type ReviewItem } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Trash2, User } from 'lucide-react';
import { Button } from '@/ui/button';
import { SideBadge } from '@/maps/badges';
import { InlineText } from '@/maps/components/inline-text';
import { formatMapDate, sideName } from '@/maps/format';
import { AddInline, DateField, PillSelect, Section } from '@/maps/pieces';
import { eligibleOwners, personName, sortMilestones } from '@/maps/view-model';
import { useReview } from './review-context';
import { CURRENCY_SIGN } from '@/cases/format';
import { isMoney, numberLabel, scoreKeysFor } from './review-model';
import { NumberField } from './scorecard-table';

export function NextArea() {
  const { held, items, addItem } = useReview();
  const commitments = items('commitment');
  return (
    <Section title={COPY.REVIEW_AREA_NEXT}>
      <div className="space-y-4">
        <NextTargets />
        <div>
          <h3 className="text-sm font-semibold">{COPY.REVIEW_COMMITMENTS}</h3>
          <p className="text-sm text-ink-3">{COPY.REVIEW_COMMITMENTS_TEXT}</p>
          {commitments.length === 0 && <p className="mt-2 text-sm text-ink-3">{COPY.REVIEW_NO_COMMITMENTS}</p>}
          <ul className="mt-1 divide-y divide-line">
            {commitments.map((c) => <Commitment key={c.id} item={c} />)}
          </ul>
          {!held && (
            <AddInline label={COPY.REVIEW_ADD_COMMITMENT} placeholder={COPY.REVIEW_COMMITMENT_PLACEHOLDER} field="title"
              onAdd={(title) => addItem('commitment', { title, side: 'us' })} />
          )}
        </div>
      </div>
    </Section>
  );
}

function NextTargets() {
  const { read, number, setNumber } = useReview();
  return (
    <div>
      <h3 className="text-sm font-semibold">{COPY.REVIEW_TARGETS_NEXT}</h3>
      <p className="text-sm text-ink-3">{COPY.REVIEW_TARGETS_NEXT_TEXT}</p>
      <ul className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {scoreKeysFor(read.categoryNumber).map((key) => {
          const label = numberLabel(key, read.categoryNumber);
          return (
            <li key={key} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{label}</span>
              <NumberField value={number(key)?.nextTarget ?? null} label={COPY.REVIEW_NEXT_TARGET_OF(label)}
                money={isMoney(key) ? { sign: read.caseCurrency ? CURRENCY_SIGN[read.caseCurrency] : null } : undefined}
                onCommit={(nextTarget) => setNumber(key, { nextTarget })} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Commitment({ item }: { item: ReviewItem }) {
  const { plan, names, today, held, errors, setItem, dispatch } = useReview();
  const error = errors[item.id];
  const locked = held || item.moved;
  const milestone = item.milestoneId ? plan.milestones.find((m) => m.id === item.milestoneId) ?? null : null;
  const update = (patch: Partial<ReviewItem>): MapApplyOutcome => setItem(item.id, patch);

  if (locked) {
    return (
      <li data-testid={`commitment-${item.id}`} className="py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 flex-1 basis-48 text-sm font-medium break-words">{item.title}</span>
          {item.moved && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-strong">{COPY.REVIEW_IN_MAP}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
          {item.side && <SideBadge side={item.side} names={names} />}
          {item.ownerId && <span>{personName(plan, item.ownerId) ?? COPY.MAP_UNKNOWN_PERSON}</span>}
          {item.dueDate && <span>{formatMapDate(item.dueDate, today)}</span>}
          {milestone && <span>{milestone.name}</span>}
        </div>
      </li>
    );
  }

  const owners = item.side ? eligibleOwners(plan, item.side) : [];
  const ownerOptions: Array<readonly [string, string]> = [['', COPY.MAP_NO_OWNER], ...owners.map((p) => [p.id, p.name] as const)];
  if (item.ownerId && !owners.some((p) => p.id === item.ownerId)) ownerOptions.push([item.ownerId, personName(plan, item.ownerId) ?? COPY.MAP_UNKNOWN_PERSON]);
  const changeSide = (side: ActivitySide | null) => {
    const ownerFits = item.ownerId === null || (side !== null && eligibleOwners(plan, side).some((p) => p.id === item.ownerId));
    return update(ownerFits ? { side } : { side, ownerId: null });
  };

  return (
    <li data-testid={`commitment-${item.id}`} className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <InlineText value={item.title} label={COPY.REVIEW_COMMITMENT} field="title" placeholder={COPY.REVIEW_COMMITMENT_PLACEHOLDER}
            className="text-sm font-medium" onCommit={(title) => update({ title })} />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <PillSelect label={COPY.REVIEW_SIDE_OF(item.title || COPY.REVIEW_COMMITMENT)} value={item.side ?? ''} className="h-7 max-w-40"
              options={[...(item.side === null ? [['', COPY.REVIEW_PICK_SIDE] as const] : []), ...ACTIVITY_SIDES.map((s) => [s, sideName(s, names)] as const)]}
              onChange={(side) => changeSide((side || null) as ActivitySide | null)} />
            <label className="inline-flex min-w-0 items-center gap-1 text-ink-2">
              <User className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <select aria-label={COPY.GUIDED_OWNER_OF(item.title || COPY.REVIEW_COMMITMENT)} value={item.ownerId ?? ''}
                onChange={(e) => update({ ownerId: e.target.value || null })}
                className="max-w-40 truncate rounded-md bg-transparent py-0.5 text-xs hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {ownerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <DateField value={item.dueDate} label={COPY.MAP_DUE_DATE} display={item.dueDate ? formatMapDate(item.dueDate, today) : COPY.MAP_NO_DATE}
              tone={item.dueDate ? 'later' : 'none'} onChange={(dueDate) => update({ dueDate })} />
            <PillSelect label={COPY.REVIEW_MILESTONE_OF(item.title || COPY.REVIEW_COMMITMENT)} value={item.milestoneId ?? ''} className="h-7 max-w-48"
              options={[['', COPY.REVIEW_NO_MILESTONE], ...sortMilestones(plan.milestones).map((m) => [m.id, m.name] as const)]}
              onChange={(milestoneId) => update({ milestoneId: milestoneId || null })} />
          </div>
          {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
        </div>
        <Button variant="ghost" size="icon" aria-label={COPY.REVIEW_DELETE_COMMITMENT}
          onClick={() => dispatch({ kind: 'delete', entity: 'reviewItem', id: item.id }, { label: COPY.DELETED })}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}
