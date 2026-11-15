'use client';

// In COPY's words. The partner step shows what Partners holds (spec 5.2: the partner, its type and stage are the record's)
// with the horizon length, the objectives step offers the business cases' benefits on the partner's side, and the people
// step offers the partner's contacts, copied in [builder's calls, spec 5.2].
import type { Activity, ActivitySide, MapApplyOutcome, MapChange, MapPlan, PlanInfo, Role, Side } from '@partner-desk/core';
import { ACTIVITY_SIDES, DEFAULT_HORIZON_DAYS, HORIZON_LENGTHS, normalizeName, ROLES } from '@partner-desk/core';
import {
  EXAMPLE_EXIT_TRIGGERS,
  exampleObjectives,
  PARTNER_TYPE_LABELS,
  partnerTypePhrase,
  STAGE_LABELS,
  starterActivities,
  suggestedMilestones,
} from '@partner-desk/method';
import {
  COPY,
  MAP_ROLE_LABELS,
} from '@partner-desk/copy';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { SideBadge, SideDot } from '../badges';
import { objectivesTitle, sideName, type SideNames } from '../format';
import { Field, fieldControl, PillSelect, Suggestions } from '../pieces';
import { eligibleOwners, sortMilestones } from '../view-model';

/** A contact of the partner in Partners, offered on the people step. */
export interface Contact { name: string; title: string; email: string | null; role: Role }

export interface StepProps {
  draft: MapPlan;
  /** The MAP's plan details joined with the partner record: its stage, start date and partner type. */
  info: PlanInfo;
  names: SideNames;
  apply: (...changes: MapChange[]) => MapApplyOutcome;
}

// ── Shared bits ────────────────────────────────────────────────────────────

function QuickAdd({ label, placeholder, field, onAdd, extra }: {
  label: string; placeholder: string; field: string; onAdd: (value: string) => MapApplyOutcome; extra?: ReactNode;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!value.trim()) return;
    const outcome = onAdd(value.trim());
    if (!outcome.ok) {
      setError(outcome.fieldErrors?.[field] ?? outcome.message);
      return;
    }
    setValue('');
    setError(null);
  };
  return (
    <form className="mt-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex flex-wrap gap-2">
        <input aria-label={label} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)}
          className={cn(fieldControl, 'flex-1 basis-48')} />
        {extra}
        <Button type="submit">{COPY.GUIDED_ADD}</Button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </form>
  );
}

function DraftList({ items, onRemove }: { items: Array<{ id: string; text: string; meta?: ReactNode }>; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2 rounded-lg bg-surface-2/70 px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="break-words">{item.text}</p>
            {item.meta}
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={COPY.GUIDED_REMOVE(item.text)} onClick={() => onRemove(item.id)}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Column({ side, title, testId, children }: { side: Side; title: string; testId: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4" data-testid={testId}>
      <h2 className="mb-3 flex min-w-0 items-center gap-2 text-sm font-semibold">
        <SideDot side={side} />
        <span className="truncate">{title}</span>
      </h2>
      {children}
    </div>
  );
}

// ── 1. Partner ─────────────────────────────────────────────────────────────

/** The partner, its type and its stage come from Partners; the horizon length is the MAP's own. */
export function PartnerStep({ info, apply }: Pick<StepProps, 'info' | 'apply'>) {
  const recruitment = info.stage === 'recruitment';
  return (
    <div className="grid max-w-xl gap-4">
      <dl className="grid gap-3 rounded-xl border border-line bg-surface p-4 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-ink-3">{COPY.GUIDED_PARTNER}</dt>
          <dd className="mt-0.5 font-medium break-words">{info.partnerName}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-ink-3">{COPY.GUIDED_PARTNER_TYPE}</dt>
          <dd className="mt-0.5 font-medium">{PARTNER_TYPE_LABELS[info.partnerType]}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-ink-3">{COPY.GUIDED_STAGE}</dt>
          <dd className="mt-0.5 font-medium">{STAGE_LABELS[info.stage]}</dd>
        </div>
        <p className="text-xs text-ink-3 sm:col-span-3">{COPY.GUIDED_FROM_RECORD}</p>
      </dl>
      <Field label={recruitment ? COPY.GUIDED_HORIZON_AT_SIGNING : COPY.GUIDED_HORIZON} className="max-w-xs">
        <select className={fieldControl} value={String(info.horizonDays)}
          onChange={(e) => apply({ kind: 'updateInfo', patch: { horizonDays: Number(e.target.value) } })}>
          {HORIZON_LENGTHS.map((d) => <option key={d} value={d}>{COPY.GUIDED_HORIZON_DAYS(d, d === DEFAULT_HORIZON_DAYS)}</option>)}
        </select>
      </Field>
    </div>
  );
}

// ── 2. Objectives ──────────────────────────────────────────────────────────

export function ObjectivesStep({ draft, info, names, apply, caseBenefits = [] }: StepProps & { caseBenefits?: string[] }) {
  const examples = exampleObjectives(info.partnerType);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(['us', 'partner'] as const).map((side) => {
        const items = draft.objectives.filter((o) => o.side === side);
        const add = (statement: string) => apply({ kind: 'add', entity: 'objective', values: { side, statement } });
        return (
          <Column key={side} side={side} testId={`draft-objectives-${side}`} title={objectivesTitle(side, names)}>
            <DraftList items={items.map((o) => ({ id: o.id, text: o.statement }))} onRemove={(id) => apply({ kind: 'delete', entity: 'objective', id })} />
            <QuickAdd label={side === 'us' ? COPY.GUIDED_ADD_OUR_OBJECTIVE : COPY.GUIDED_ADD_THEIR_OBJECTIVE}
              placeholder={COPY.GUIDED_OBJECTIVE_PLACEHOLDER} field="statement" onAdd={add} />
            {side === 'partner' && (
              <div className="mt-3">
                <Suggestions title={COPY.GUIDED_FROM_CASE} onPick={add}
                  items={caseBenefits.filter((b) => !examples.partner.includes(b) && !items.some((o) => o.statement === b))} />
              </div>
            )}
            <div className="mt-3">
              <Suggestions title={COPY.GUIDED_EXAMPLES} items={examples[side].filter((e) => !items.some((o) => o.statement === e))} onPick={add} />
            </div>
          </Column>
        );
      })}
    </div>
  );
}

// ── 3. People ──────────────────────────────────────────────────────────────

const ROLE_HINTS: Role[] = ['partner_manager', 'exec_sponsor', 'sales_lead', 'technical_lead', 'marketing_lead'];

export function PeopleStep({ contacts, ...props }: StepProps & { contacts: Contact[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PeopleColumn side="us" title={sideName('us', props.names)} contacts={[]} {...props} />
      <PeopleColumn side="partner" title={sideName('partner', props.names)} contacts={contacts} {...props} />
    </div>
  );
}

function PeopleColumn({ side, title, draft, names, apply, contacts }: StepProps & { side: Side; title: string; contacts: Contact[] }) {
  const people = draft.people.filter((p) => p.side === side);
  const missing = ROLE_HINTS.filter((r) => !people.some((p) => p.role === r));
  const [role, setRole] = useState<Role>(missing[0] ?? 'other');
  // A contact is offered until someone of that name is in the MAP, on either side (names are unique in a MAP).
  const offered = contacts.filter((c) => !draft.people.some((p) => normalizeName(p.name) === normalizeName(c.name)));
  const addContact = (name: string) => {
    const contact = offered.find((c) => c.name === name);
    if (contact) apply({ kind: 'add', entity: 'person', values: { side, ...contact } });
  };
  return (
    <Column side={side} title={title} testId={`draft-people-${side}`}>
      <DraftList
        items={people.map((p) => ({ id: p.id, text: p.name, meta: <p className="text-xs text-ink-3">{MAP_ROLE_LABELS[p.role]}</p> }))}
        onRemove={(id) => apply({ kind: 'delete', entity: 'person', id })}
      />
      {offered.length > 0 && (
        <div className="mt-3">
          <Suggestions title={COPY.GUIDED_FROM_CONTACTS(names.partner)} items={offered.map((c) => c.name)} onPick={addContact} />
        </div>
      )}
      <QuickAdd label={side === 'us' ? COPY.GUIDED_ADD_COLLEAGUE : COPY.GUIDED_ADD_CONTACT} placeholder={COPY.GUIDED_FULL_NAME} field="name"
        onAdd={(name) => apply({ kind: 'add', entity: 'person', values: { side, name, role } })}
        extra={<PillSelect label={COPY.GUIDED_ROLE} value={role} onChange={(v) => setRole(v as Role)} className="h-9"
          options={ROLES.map((r) => [r, MAP_ROLE_LABELS[r]] as const)} />} />
      {missing.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-3">{COPY.GUIDED_SUGGESTED_ROLES}</span>
          {missing.slice(0, 3).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)}
              className={cn('rounded-full border px-2 py-0.5', role === r ? 'border-brand text-brand-strong' : 'border-line text-ink-2 hover:border-ink-3')}>
              {MAP_ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </Column>
  );
}

// ── 4. Activities ──────────────────────────────────────────────────────────

export function ActivitiesStep({ draft, info, names, apply }: StepProps) {
  const [side, setSide] = useState<ActivitySide>('us');
  const starters = starterActivities(info.partnerType, info.stage).filter((s) => !draft.activities.some((a) => a.title === s.title));
  return (
    <div className="space-y-4">
      <Suggestions
        title={COPY.GUIDED_SUGGESTED_FOR(partnerTypePhrase(info.partnerType), STAGE_LABELS[info.stage].toLowerCase())}
        items={starters.map((s) => s.title)}
        onPick={(title) => {
          const starter = starters.find((s) => s.title === title);
          if (starter) apply({ kind: 'add', entity: 'activity', values: { ...starter } });
        }}
      />
      <ul className="space-y-2">
        {draft.activities.map((a) => <DraftActivity key={a.id} activity={a} draft={draft} info={info} names={names} apply={apply} />)}
      </ul>
      <QuickAdd label={COPY.GUIDED_ADD_ACTIVITY} placeholder={COPY.GUIDED_ACTIVITY_PLACEHOLDER} field="title"
        onAdd={(title) => apply({ kind: 'add', entity: 'activity', values: { title, side } })}
        extra={<PillSelect label={COPY.GUIDED_SIDE} value={side} onChange={(v) => setSide(v as ActivitySide)} className="h-9"
          options={ACTIVITY_SIDES.map((s) => [s, sideName(s, names)] as const)} />} />
    </div>
  );
}

function DraftActivity({ activity, draft, names, apply }: StepProps & { activity: Activity }) {
  const update = (patch: Partial<Activity>) => apply({ kind: 'update', entity: 'activity', id: activity.id, patch });
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium break-words">{activity.title}</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={COPY.GUIDED_REMOVE(activity.title)}
          onClick={() => apply({ kind: 'delete', entity: 'activity', id: activity.id })}>
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <SideBadge side={activity.side} names={names} />
        <select aria-label={COPY.GUIDED_OWNER_OF(activity.title)} className={cn(fieldControl, 'h-8 w-auto max-w-48 text-xs')}
          value={activity.ownerId ?? ''} onChange={(e) => update({ ownerId: e.target.value || null })}>
          <option value="">{COPY.GUIDED_NO_OWNER}</option>
          {eligibleOwners(draft, activity.side).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" aria-label={COPY.GUIDED_DUE_OF(activity.title)} className={cn(fieldControl, 'h-8 w-auto text-xs')}
          value={activity.dueDate ?? ''} onChange={(e) => update({ dueDate: e.target.value || null })} />
      </div>
    </li>
  );
}

// ── 5. Milestones and exit triggers ────────────────────────────────────────

export function MilestonesStep({ draft, info, apply }: StepProps) {
  const suggestions = suggestedMilestones(info.startDate).filter((s) => !draft.milestones.some((m) => m.name === s.name));
  const triggers = EXAMPLE_EXIT_TRIGGERS.filter((t) => !draft.exitTriggers.some((x) => x.condition === t));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">{COPY.GUIDED_MILESTONES}</h2>
        <DraftList
          items={sortMilestones(draft.milestones).map((m) => ({
            id: m.id,
            text: m.name,
            meta: (
              <input type="date" aria-label={COPY.GUIDED_TARGET_OF(m.name)} className={cn(fieldControl, 'mt-1 h-8 w-auto text-xs')}
                value={m.targetDate ?? ''} onChange={(e) => apply({ kind: 'update', entity: 'milestone', id: m.id, patch: { targetDate: e.target.value || null } })} />
            ),
          }))}
          onRemove={(id) => apply({ kind: 'delete', entity: 'milestone', id })}
        />
        <div className="mt-3">
          <Suggestions title={COPY.GUIDED_SUGGESTED_CHECK_INS} items={suggestions.map((s) => s.name)} onPick={(name) => {
            const suggestion = suggestions.find((s) => s.name === name);
            if (suggestion) apply({ kind: 'add', entity: 'milestone', values: { ...suggestion } });
          }} />
        </div>
        <QuickAdd label={COPY.GUIDED_ADD_MILESTONE} placeholder={COPY.GUIDED_MILESTONE_PLACEHOLDER} field="name"
          onAdd={(name) => apply({ kind: 'add', entity: 'milestone', values: { name } })} />
      </div>
      <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">{COPY.GUIDED_EXIT_TRIGGERS}</h2>
        <DraftList items={draft.exitTriggers.map((x) => ({ id: x.id, text: x.condition }))} onRemove={(id) => apply({ kind: 'delete', entity: 'exitTrigger', id })} />
        <div className="mt-3">
          <Suggestions title={COPY.GUIDED_COMMON_TRIGGERS} items={triggers} onPick={(condition) => apply({ kind: 'add', entity: 'exitTrigger', values: { condition } })} />
        </div>
        <QuickAdd label={COPY.GUIDED_ADD_TRIGGER} placeholder={COPY.GUIDED_TRIGGER_PLACEHOLDER} field="condition"
          onAdd={(condition) => apply({ kind: 'add', entity: 'exitTrigger', values: { condition } })} />
      </div>
    </div>
  );
}
