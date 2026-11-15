'use client';

// In COPY's words. A person with a link (`link`) is what the MAP app called a collaborator.
import {
  ACTIVITY_SIDES, ACTIVITY_STATUSES, CATEGORIES, type Activity, type ActivitySide, type Category, type JoinedPlan, type MapApplyOutcome,
} from '@partner-desk/core';
import {
  partnerTypePhrase,
  reviewActivities,
  STAGE_LABELS,
  starterActivities,
  type StarterActivity,
} from '@partner-desk/method';
import {
  COPY,
  MAP_ACTIVITY_STATUS_LABELS,
  MAP_CATEGORY_LABELS,
} from '@partner-desk/copy';
import { ChevronDown, Trash2, User } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { MilestoneStatusTag, SideBadge } from '../badges';
import { formatMapDate, sideName } from '../format';
import { AddInline, DateField, Field, fieldControl, PillSelect, Section, Suggestions } from '../pieces';
import {
  DEFAULT_FILTERS, dueState, eligibleOwners, filterActivities, groupActivities, isFiltered, personName, reviewDue, sortMilestones,
  type ActivityFilters, type ActivityGroup,
} from '../view-model';
import { InlineText } from './inline-text';
import { usePlan } from './plan-context';
import { StatusControl } from './status-control';

type AddActivity = (values: Record<string, unknown>, label: string) => MapApplyOutcome;

export function ActivitiesSection() {
  const { plan, today, dispatch, idFor } = usePlan();
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  /** Activities added since the filters last changed (local ids); shown even when they don't match. */
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const keep = new Set([...added].map(idFor));
  const visible = filterActivities(plan.activities, filters, keep);
  const filtered = isFiltered(filters);
  const groups = groupActivities(plan, visible, today).filter((g) => !filtered || g.activities.length > 0);

  const changeFilters = (next: ActivityFilters) => {
    setFilters(next);
    setAdded(new Set());
  };
  const addActivity: AddActivity = (values, label) => {
    const outcome = dispatch({ kind: 'add', entity: 'activity', values }, { label });
    if (outcome.ok && outcome.entityId) {
      const id = outcome.entityId;
      setAdded((ids) => new Set(ids).add(id));
    }
    return outcome;
  };

  return (
    <Section
      title={COPY.MAP_ACTIVITIES}
      description={COPY.MAP_ACTIVITIES_TEXT}
      actions={<FilterBar filters={filters} onChange={changeFilters} />}
    >
      {reviewDue(plan.info, today) && <ReviewSuggestions onAdd={addActivity} />}
      {plan.activities.length < 3 && <StarterSuggestions onAdd={addActivity} />}
      {filtered && visible.length === 0 && (
        <p className="py-4 text-sm text-ink-3">
          {COPY.MAP_NO_MATCH}{' '}
          <button type="button" className="font-medium text-brand-strong underline-offset-2 hover:underline" onClick={() => changeFilters(DEFAULT_FILTERS)}>
            {COPY.MAP_CLEAR_FILTERS}
          </button>
        </p>
      )}
      <div className="mt-2 space-y-4">
        {groups.map((g) => <GroupView key={g.key} group={g} onAdd={addActivity} />)}
      </div>
    </Section>
  );
}

function FilterBar({ filters, onChange }: { filters: ActivityFilters; onChange: (f: ActivityFilters) => void }) {
  const { plan, names } = usePlan();
  return (
    <div role="group" aria-label={COPY.MAP_FILTER_ACTIVITIES} className="flex w-full flex-wrap gap-2 sm:w-auto">
      <PillSelect label={COPY.MAP_SIDE} value={filters.side}
        options={[['all', COPY.MAP_ALL_SIDES], ...ACTIVITY_SIDES.map((s) => [s, sideName(s, names)] as const)]}
        onChange={(side) => onChange({ ...filters, side: side as ActivityFilters['side'] })} className="max-w-40" />
      <PillSelect label={COPY.MAP_OWNER} value={filters.ownerId}
        options={[['all', COPY.MAP_ANYONE], ['none', COPY.MAP_NO_OWNER], ...plan.people.map((p) => [p.id, p.name] as const)]}
        onChange={(ownerId) => onChange({ ...filters, ownerId })} className="max-w-40" />
      <PillSelect label={COPY.MAP_STATUS} value={filters.status}
        options={[['all', COPY.MAP_ANY_STATUS], ['open', COPY.MAP_OPEN], ...ACTIVITY_STATUSES.map((s) => [s, MAP_ACTIVITY_STATUS_LABELS[s]] as const)]}
        onChange={(status) => onChange({ ...filters, status: status as ActivityFilters['status'] })} />
    </div>
  );
}

/** The suggestions this viewer may add: those not on the plan yet, and for a person with a link only their side's. Null if they can't add. */
function useOfferable(suggestions: StarterActivity[]): StarterActivity[] | null {
  const { plan, allowed, actor } = usePlan();
  const existing = new Set(plan.activities.map((a) => a.title));
  const ownSide: ActivitySide = actor.kind === 'link' ? actor.side : 'us';
  if (!allowed({ kind: 'add', entity: 'activity', values: { title: '', side: ownSide, category: 'other' } })) return null;
  return suggestions.filter((s) => !existing.has(s.title) && (actor.kind !== 'link' || s.side === actor.side));
}

function StarterSuggestions({ onAdd }: { onAdd: AddActivity }) {
  const { plan } = usePlan();
  const starters = useOfferable(starterActivities(plan.info.partnerType, plan.info.stage));
  if (!starters) return null;
  return (
    <Suggestions
      title={COPY.MAP_SUGGESTED_FOR(partnerTypePhrase(plan.info.partnerType), STAGE_LABELS[plan.info.stage].toLowerCase())}
      items={starters.map((s) => s.title)}
      onPick={(title) => {
        const starter = starters.find((s) => s.title === title);
        if (starter) onAdd({ ...starter }, COPY.MAP_CHANGED.activityAdded);
      }}
    />
  );
}

/**
 * At the end of a horizon: the business review. The owner is pointed to the review page (reviews spec 6); a person with
 * a link to Present for holding it.
 */
function ReviewSuggestions({ onAdd }: { onAdd: AddActivity }) {
  const { presentHref, reviewHref } = usePlan();
  const review = useOfferable(reviewActivities());
  const link = 'font-medium text-brand-strong underline-offset-2 hover:underline';
  return (
    <div className="mb-3 space-y-2">
      {reviewHref ? (
        <p className="text-sm text-ink-2">
          {COPY.MAP_REVIEW_COMING_PREP}{' '}
          <Link href={reviewHref} className={link}>{COPY.MAP_PREPARE_REVIEW}</Link>
          .
        </p>
      ) : (
        <p className="text-sm text-ink-2">
          {COPY.MAP_REVIEW_COMING}{' '}
          {presentHref ? <Link href={presentHref} className={link}>{COPY.MAP_PRESENT}</Link> : COPY.MAP_PRESENT}
          .
        </p>
      )}
      {review && (
        <Suggestions
          title={COPY.MAP_REVIEW_SUGGESTED}
          items={review.map((s) => s.title)}
          onPick={(title) => {
            const suggestion = review.find((s) => s.title === title);
            if (suggestion) onAdd({ ...suggestion }, COPY.MAP_CHANGED.activityAdded);
          }}
        />
      )}
    </div>
  );
}

function GroupView({ group, onAdd }: { group: ActivityGroup; onAdd: AddActivity }) {
  const { names, today, allowed, actor } = usePlan();
  const ownSide: ActivitySide = actor.kind === 'link' ? actor.side : 'us';
  const [side, setSide] = useState<ActivitySide>(ownSide);
  const title = group.milestone?.name ?? COPY.MAP_UNSCHEDULED;
  const done = group.activities.filter((a) => a.status === 'done').length;
  const canAdd = allowed({ kind: 'add', entity: 'activity', values: { title: '', side } });
  const milestoneId = group.milestone?.id ?? null;
  const withMilestone = milestoneId !== null && allowed({ kind: 'add', entity: 'activity', values: { title: '', side, milestoneId } });

  return (
    <div data-group={group.key}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line pb-1.5">
        <h3 className="min-w-0 text-sm font-semibold break-words">{title}</h3>
        {group.milestone?.targetDate && <span className="text-xs text-ink-3">{formatMapDate(group.milestone.targetDate, today)}</span>}
        {group.status && <MilestoneStatusTag status={group.status} />}
        {group.activities.length > 0 && <span className="ml-auto text-xs text-ink-3">{COPY.MAP_DONE_COUNT(done, group.activities.length)}</span>}
      </div>
      {group.activities.length === 0 && <p className="py-2 text-sm text-ink-3">{COPY.MAP_NO_ACTIVITIES}</p>}
      <ul className="divide-y divide-line">
        {group.activities.map((a) => <ActivityRow key={a.id} activity={a} />)}
      </ul>
      {canAdd && (
        <AddInline
          label={COPY.MAP_ADD_ACTIVITY}
          placeholder={COPY.MAP_ACTIVITY_PLACEHOLDER}
          field="title"
          onAdd={(text) => onAdd({ title: text, side, ...(withMilestone ? { milestoneId } : {}) }, COPY.MAP_CHANGED.activityAdded)}
          extra={actor.kind === 'link' ? null : (
            <PillSelect label={COPY.MAP_SIDE_FOR_NEW} value={side} onChange={(v) => setSide(v as ActivitySide)}
              options={ACTIVITY_SIDES.map((s) => [s, sideName(s, names)] as const)} className="h-9 max-w-40" />
          )}
        />
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const { names, today, dispatch, allowed } = usePlan();
  const [open, setOpen] = useState(false);
  const may = (patch: Record<string, unknown>) => allowed({ kind: 'update', entity: 'activity', id: activity.id, patch });
  const update = (patch: Partial<Activity>, label: string) =>
    dispatch({ kind: 'update', entity: 'activity', id: activity.id, patch }, { label });
  const due = dueState(activity, today);

  return (
    <li id={`activity-${activity.id}`} className="scroll-mt-20 py-2.5">
      <div className="flex items-start gap-3">
        <StatusControl status={activity.status} disabled={!may({ status: activity.status })}
          onChange={(status) => update({ status }, COPY.MAP_MARKED(MAP_ACTIVITY_STATUS_LABELS[status]))} />
        <div className="min-w-0 flex-1">
          <InlineText value={activity.title} label={COPY.MAP_ACTIVITY} field="title" disabled={!may({ title: '' })}
            className={cn('text-sm font-medium', activity.status === 'done' && 'text-ink-3 line-through decoration-ink-3/50')}
            onCommit={(title) => update({ title }, COPY.MAP_CHANGED.activityRenamed)} />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <SideBadge side={activity.side} names={names} />
            <OwnerSelect activity={activity} disabled={!may({ ownerId: null })} onChange={(ownerId) => update({ ownerId }, COPY.MAP_CHANGED.ownerChanged)} />
            <DateField value={activity.dueDate} label={COPY.MAP_DUE_DATE} display={due.label} tone={due.tone} disabled={!may({ dueDate: null })}
              onChange={(dueDate) => update({ dueDate }, COPY.MAP_CHANGED.dueDateChanged)} />
            {activity.note && !open && <span className="min-w-0 max-w-full truncate text-ink-3">{activity.note}</span>}
          </div>
          {open && <ActivityDetails activity={activity} may={may} update={update} />}
        </div>
        <Button variant="ghost" size="icon" aria-label={open ? COPY.MAP_HIDE_DETAILS : COPY.MAP_SHOW_DETAILS} aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
        </Button>
      </div>
    </li>
  );
}

function OwnerSelect({ activity, disabled, onChange }: { activity: Activity; disabled: boolean; onChange: (ownerId: string | null) => void }) {
  const { plan } = usePlan();
  const options: Array<readonly [string, string]> = [['', COPY.MAP_NO_OWNER], ...eligibleOwners(plan, activity.side).map((p) => [p.id, p.name] as const)];
  if (activity.ownerId && !options.some(([id]) => id === activity.ownerId)) {
    options.push([activity.ownerId, personName(plan, activity.ownerId) ?? COPY.MAP_UNKNOWN_PERSON]);
  }
  return (
    <label className="inline-flex min-w-0 items-center gap-1 text-ink-2">
      <User className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <select aria-label={COPY.GUIDED_OWNER_OF(activity.title || COPY.MAP_UNTITLED)} value={activity.ownerId ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}
        className="max-w-40 truncate rounded-md bg-transparent py-0.5 text-xs hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:appearance-none disabled:hover:bg-transparent">
        {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}

/** A side change, clearing the owner in the same change if they can't own the activity on the new side. */
function sidePatch(plan: JoinedPlan, activity: Activity, side: ActivitySide): Partial<Activity> {
  const ownerFits = activity.ownerId === null || eligibleOwners(plan, side).some((p) => p.id === activity.ownerId);
  return ownerFits ? { side } : { side, ownerId: null };
}

function ActivityDetails({ activity, may, update }: {
  activity: Activity; may: (patch: Record<string, unknown>) => boolean; update: (patch: Partial<Activity>, label: string) => MapApplyOutcome;
}) {
  const { plan, names, today, dispatch, allowed } = usePlan();
  const deletable = allowed({ kind: 'delete', entity: 'activity', id: activity.id });
  return (
    <div className="mt-3 grid gap-3 rounded-xl bg-surface-2/60 p-3 sm:grid-cols-3">
      <Field label={COPY.MAP_CATEGORY}>
        <select className={fieldControl} value={activity.category} disabled={!may({ category: activity.category })}
          onChange={(e) => update({ category: e.target.value as Category }, COPY.MAP_CHANGED.categoryChanged)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{MAP_CATEGORY_LABELS[c]}</option>)}
        </select>
      </Field>
      <Field label={COPY.MAP_SIDE}>
        <select className={fieldControl} value={activity.side} disabled={!may({ side: activity.side })}
          onChange={(e) => update(sidePatch(plan, activity, e.target.value as ActivitySide), COPY.MAP_CHANGED.sideChanged)}>
          {ACTIVITY_SIDES.map((s) => <option key={s} value={s}>{sideName(s, names)}</option>)}
        </select>
      </Field>
      <Field label={COPY.MAP_MILESTONE}>
        <select className={fieldControl} value={activity.milestoneId ?? ''} disabled={!may({ milestoneId: null })}
          onChange={(e) => update({ milestoneId: e.target.value || null }, COPY.MAP_CHANGED.milestoneChanged)}>
          <option value="">{COPY.MAP_UNSCHEDULED}</option>
          {sortMilestones(plan.milestones).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-3">
        <p className="mb-1 text-xs font-medium text-ink-3">{COPY.MAP_NOTE}</p>
        <InlineText value={activity.note} label={COPY.MAP_NOTE} field="note" multiline placeholder={COPY.MAP_ADD_NOTE} disabled={!may({ note: '' })}
          className="text-sm" onCommit={(note) => update({ note }, COPY.MAP_CHANGED.noteSaved)} />
      </div>
      <p className="text-xs text-ink-3 sm:col-span-2">
        {activity.completedDate && <>{COPY.MAP_COMPLETED_ON(formatMapDate(activity.completedDate, today))} </>}
        {activity.updatedBy && COPY.MAP_LAST_UPDATED_BY(activity.updatedBy)}
      </p>
      {deletable && (
        <div className="sm:text-right">
          <Button variant="danger" size="sm"
            onClick={() => dispatch({ kind: 'delete', entity: 'activity', id: activity.id }, { label: COPY.MAP_CHANGED.activityDeleted })}>
            <Trash2 className="h-4 w-4" aria-hidden />
            {COPY.MAP_DELETE_ACTIVITY}
          </Button>
        </div>
      )}
    </div>
  );
}
