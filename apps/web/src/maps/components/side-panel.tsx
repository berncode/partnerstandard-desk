'use client';

// The side panel, in COPY's words.
import {
  milestoneStatus, ROLES,
  type ExitStatus, type ExitTrigger, type MapApplyOutcome, type MapPerson, type Milestone, type MilestoneStatus, type Role, type Side,
} from '@partner-desk/core';
import { EXAMPLE_EXIT_TRIGGERS, suggestedMilestones } from '@partner-desk/method';
import { COPY, MAP_EXIT_STATUS_LABELS, MAP_ROLE_LABELS } from '@partner-desk/copy';
import { CircleCheck, Mail, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { MilestoneStatusTag, SideDot } from '../badges';
import { formatMapDate, sideName } from '../format';
import { AddInline, DateField, PillSelect, Section, Suggestions } from '../pieces';
import { peopleOnSide, sortMilestones } from '../view-model';
import { InlineText } from './inline-text';
import { usePlan } from './plan-context';

export function SidePanel() {
  return (
    <>
      <PeopleSection />
      <MilestonesSection />
      <ExitTriggersSection />
    </>
  );
}

// People

const SUGGESTED_ROLES: Record<Side, Role[]> = {
  us: ['partner_manager', 'exec_sponsor', 'sales_lead'],
  partner: ['partner_manager', 'exec_sponsor', 'sales_lead'],
};

function PeopleSection() {
  const { names } = usePlan();
  return (
    <Section title={COPY.MAP_PEOPLE} description={COPY.MAP_PEOPLE_TEXT}>
      <div className="space-y-5">
        <PeopleGroup side="us" title={sideName('us', names)} />
        <PeopleGroup side="partner" title={sideName('partner', names)} />
      </div>
    </Section>
  );
}

function PeopleGroup({ side, title }: { side: Side; title: string }) {
  const { plan, dispatch, allowed } = usePlan();
  const people = peopleOnSide(plan, side);
  const missing = SUGGESTED_ROLES[side].filter((r) => !people.some((p) => p.role === r));
  const [role, setRole] = useState<Role>(missing[0] ?? 'other');
  const canAdd = allowed({ kind: 'add', entity: 'person', values: { side, name: '', role } });

  return (
    <div data-testid={`people-${side}`}>
      <h3 className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold">
        <SideDot side={side} />
        <span className="truncate">{title}</span>
      </h3>
      {people.length === 0 && <p className="text-sm text-ink-3">{COPY.MAP_NOBODY_YET}</p>}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line empty:hidden">
        {people.map((person) => <PersonItem key={person.id} person={person} />)}
      </ul>
      {canAdd && missing.length > 0 && (
        <p className="mt-2 text-xs text-ink-3">{COPY.MAP_SUGGESTED_ROLES(missing.map((r) => MAP_ROLE_LABELS[r]).join(', '))}</p>
      )}
      {canAdd && (
        <AddInline
          label={COPY.MAP_ADD_PERSON}
          placeholder={COPY.GUIDED_FULL_NAME}
          field="name"
          onAdd={(name) => dispatch({ kind: 'add', entity: 'person', values: { side, name, role } }, { label: COPY.MAP_CHANGED.personAdded })}
          extra={<PillSelect label={COPY.GUIDED_ROLE} value={role} onChange={(v) => setRole(v as Role)} className="h-9"
            options={ROLES.map((r) => [r, MAP_ROLE_LABELS[r]] as const)} />}
        />
      )}
    </div>
  );
}

function PersonItem({ person }: { person: MapPerson }) {
  const { dispatch, allowed } = usePlan();
  const editable = allowed({ kind: 'update', entity: 'person', id: person.id, patch: { name: '' } });
  const deletable = allowed({ kind: 'delete', entity: 'person', id: person.id });
  const update = (patch: Partial<MapPerson>, label: string): MapApplyOutcome =>
    dispatch({ kind: 'update', entity: 'person', id: person.id, patch }, { label });

  return (
    <li className="px-2.5 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <InlineText value={person.name} label={COPY.MAP_NAME} field="name" disabled={!editable} className="text-sm font-medium"
            onCommit={(name) => update({ name }, COPY.MAP_CHANGED.nameChanged)} />
          <InlineText value={person.title} label={COPY.MAP_JOB_TITLE} field="title" placeholder={COPY.MAP_JOB_TITLE} disabled={!editable}
            className="text-xs text-ink-2" onCommit={(title) => update({ title }, COPY.MAP_CHANGED.jobTitleChanged)} />
          <InlineText value={person.email ?? ''} label={COPY.MAP_EMAIL} field="email" placeholder={COPY.MAP_ADD_EMAIL} disabled={!editable} icon={Mail}
            className="text-xs text-ink-2" emptyClassName="font-medium text-brand-strong"
            onCommit={(email) => update({ email: email.trim() || null }, COPY.MAP_CHANGED.emailChanged)} />
          {editable && !person.email && <p className="text-[11px] text-ink-3">{COPY.MAP_EMAIL_NEEDED}</p>}
          <PillSelect label={COPY.MAP_ROLE_OF(person.name)} value={person.role} disabled={!editable} className="mt-1 h-7"
            options={ROLES.map((r) => [r, MAP_ROLE_LABELS[r]] as const)}
            onChange={(role) => update({ role: role as Role }, COPY.MAP_CHANGED.roleChanged)} />
        </div>
        {deletable && (
          <Button variant="ghost" size="icon" aria-label={COPY.GUIDED_REMOVE(person.name)}
            onClick={() => dispatch({ kind: 'delete', entity: 'person', id: person.id }, { label: COPY.MAP_CHANGED.personRemoved })}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

// Milestones

const DOT: Record<MilestoneStatus, string> = {
  achieved: 'border-brand bg-brand',
  missed: 'border-danger bg-danger-soft',
  upcoming: 'border-ink-3 bg-surface',
};

function MilestonesSection() {
  const { plan, dispatch, allowed } = usePlan();
  const milestones = sortMilestones(plan.milestones);
  const canAdd = allowed({ kind: 'add', entity: 'milestone', values: { name: '' } });
  const suggestions = suggestedMilestones(plan.info.startDate).filter((s) => !plan.milestones.some((m) => m.name === s.name));

  return (
    <Section title={COPY.GUIDED_MILESTONES} description={COPY.MAP_MILESTONES_TEXT}>
      {milestones.length > 0 && (
        <ol className="space-y-3 border-l border-line pl-5">
          {milestones.map((m) => <MilestoneItem key={m.id} milestone={m} />)}
        </ol>
      )}
      {milestones.length === 0 && (canAdd ? (
        <Suggestions title={COPY.GUIDED_SUGGESTED_CHECK_INS} items={suggestions.map((s) => s.name)} onPick={(name) => {
          const suggestion = suggestions.find((s) => s.name === name);
          if (suggestion) dispatch({ kind: 'add', entity: 'milestone', values: { ...suggestion } }, { label: COPY.MAP_CHANGED.milestoneAdded });
        }} />
      ) : <p className="text-sm text-ink-3">{COPY.MAP_NO_MILESTONES}</p>)}
      {canAdd && (
        <AddInline label={COPY.GUIDED_ADD_MILESTONE} placeholder={COPY.GUIDED_MILESTONE_PLACEHOLDER} field="name"
          onAdd={(name) => dispatch({ kind: 'add', entity: 'milestone', values: { name } }, { label: COPY.MAP_CHANGED.milestoneAdded })} />
      )}
    </Section>
  );
}

function MilestoneItem({ milestone }: { milestone: Milestone }) {
  const { plan, today, dispatch, allowed } = usePlan();
  const status = milestoneStatus(milestone, today, plan.info.stage);
  const editable = allowed({ kind: 'update', entity: 'milestone', id: milestone.id, patch: { name: '' } });
  const deletable = allowed({ kind: 'delete', entity: 'milestone', id: milestone.id });
  const update = (patch: Partial<Milestone>, label: string): MapApplyOutcome =>
    dispatch({ kind: 'update', entity: 'milestone', id: milestone.id, patch }, { label });

  return (
    <li className="relative">
      <span aria-hidden className={cn('absolute top-1 -left-[1.6rem] h-3 w-3 rounded-full border-2', DOT[status])} />
      <InlineText value={milestone.name} label={COPY.MAP_MILESTONE} field="name" disabled={!editable} className="text-sm font-medium"
        onCommit={(name) => update({ name }, COPY.MAP_CHANGED.milestoneRenamed)} />
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <DateField value={milestone.targetDate} label={COPY.MAP_TARGET_DATE} disabled={!editable}
          display={milestone.targetDate ? formatMapDate(milestone.targetDate, today) : COPY.MAP_NO_DATE}
          tone={status === 'missed' ? 'overdue' : milestone.targetDate ? 'later' : 'none'}
          onChange={(targetDate) => update({ targetDate }, COPY.MAP_CHANGED.targetDateChanged)} />
        <MilestoneStatusTag status={status} />
      </div>
      <InlineText value={milestone.criteria} label={COPY.MAP_CRITERIA} field="criteria" placeholder={COPY.MAP_CRITERIA_PLACEHOLDER} multiline disabled={!editable}
        className="mt-1 text-xs text-ink-2" onCommit={(criteria) => update({ criteria }, COPY.MAP_CHANGED.criteriaChanged)} />
      {(editable || deletable) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {editable && (milestone.achievedDate ? (
            <>
              <span className="text-xs font-medium text-brand-strong">{COPY.MAP_ACHIEVED_ON(formatMapDate(milestone.achievedDate, today))}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => update({ achievedDate: null }, COPY.MAP_CHANGED.milestoneReopened)}>{COPY.MAP_REOPEN}</Button>
            </>
          ) : (
            <Button size="sm" className="h-7 text-xs" onClick={() => update({ achievedDate: today }, COPY.MAP_CHANGED.milestoneAchieved)}>
              <CircleCheck className="h-3.5 w-3.5" aria-hidden />
              {COPY.MAP_MARK_ACHIEVED}
            </Button>
          ))}
          {deletable && (
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={COPY.MAP_DELETE_MILESTONE(milestone.name)}
              onClick={() => dispatch({ kind: 'delete', entity: 'milestone', id: milestone.id }, { label: COPY.MAP_CHANGED.milestoneDeleted })}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// Exit triggers

const EXIT_NEXT: Record<ExitStatus, ExitStatus> = { ok: 'watch', watch: 'triggered', triggered: 'ok' };
const EXIT_STYLE: Record<ExitStatus, string> = {
  ok: 'border-line bg-surface text-ink-2',
  watch: 'border-warn/30 bg-warn-soft text-warn',
  triggered: 'border-danger/30 bg-danger-soft text-danger',
};

function ExitTriggersSection() {
  const { plan, dispatch, allowed } = usePlan();
  const canAdd = allowed({ kind: 'add', entity: 'exitTrigger', values: { condition: '' } });
  const add = (condition: string) => dispatch({ kind: 'add', entity: 'exitTrigger', values: { condition } }, { label: COPY.MAP_CHANGED.exitTriggerAdded });

  return (
    <Section title={COPY.GUIDED_EXIT_TRIGGERS} description={COPY.MAP_EXIT_TEXT}>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line empty:hidden">
        {plan.exitTriggers.map((x) => <ExitTriggerItem key={x.id} trigger={x} />)}
      </ul>
      {plan.exitTriggers.length === 0 && (canAdd
        ? <Suggestions title={COPY.GUIDED_COMMON_TRIGGERS} items={EXAMPLE_EXIT_TRIGGERS} onPick={add} />
        : <p className="text-sm text-ink-3">{COPY.MAP_NO_EXIT_TRIGGERS}</p>)}
      {canAdd && <AddInline label={COPY.GUIDED_ADD_TRIGGER} placeholder={COPY.GUIDED_TRIGGER_PLACEHOLDER} field="condition" onAdd={add} />}
    </Section>
  );
}

function ExitTriggerItem({ trigger }: { trigger: ExitTrigger }) {
  const { dispatch, allowed } = usePlan();
  const editable = allowed({ kind: 'update', entity: 'exitTrigger', id: trigger.id, patch: { condition: '' } });
  const deletable = allowed({ kind: 'delete', entity: 'exitTrigger', id: trigger.id });
  const update = (patch: Partial<ExitTrigger>, label: string): MapApplyOutcome =>
    dispatch({ kind: 'update', entity: 'exitTrigger', id: trigger.id, patch }, { label });
  const next = EXIT_NEXT[trigger.status];
  const label = MAP_EXIT_STATUS_LABELS;

  return (
    <li className="flex items-start gap-2 px-2.5 py-2">
      <button type="button" disabled={!editable} onClick={() => update({ status: next }, COPY.MAP_EXIT_SET_TO(label[next]))}
        aria-label={editable ? COPY.MAP_EXIT_STATUS_CHANGE(label[trigger.status], label[next]) : COPY.MAP_EXIT_STATUS_IS(label[trigger.status])}
        className={cn('mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand', EXIT_STYLE[trigger.status])}>
        {label[trigger.status]}
      </button>
      <div className="min-w-0 flex-1">
        <InlineText value={trigger.condition} label={COPY.MAP_EXIT_TRIGGER} field="condition" multiline disabled={!editable} className="text-sm"
          onCommit={(condition) => update({ condition }, COPY.MAP_CHANGED.exitTriggerUpdated)} />
      </div>
      {deletable && (
        <Button variant="ghost" size="icon" aria-label={COPY.MAP_DELETE_EXIT_TRIGGER}
          onClick={() => dispatch({ kind: 'delete', entity: 'exitTrigger', id: trigger.id }, { label: COPY.MAP_CHANGED.exitTriggerDeleted })}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </li>
  );
}
