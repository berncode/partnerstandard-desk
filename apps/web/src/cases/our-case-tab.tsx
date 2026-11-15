'use client';

// Our case (tab 3 of a case). PartnerStandard Desk keeps one editor for the whole case in the case's layout (as for the other
// tabs), so this tab shows and changes the same case with one save at a time, with no autosave, tabs or leave hooks of its
// own. The level names are the case's own (`offer.levels`) where the Business Case app wrote Preferred.
import {
  parseCase, type Alone, type CaseSource as Source, type Churn, type Efficiency, type OurCase,
  type StrategicReason,
} from '@partner-desk/core';
import { X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Field, fieldControl } from '@/programs/field';
import { MoneyInput } from '@/programs/money-input';
import { NumberInput } from '@/programs/number-input';
import { PercentInput } from '@/programs/percent-input';
import { useViewer } from '@/storage-context';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ClosedForViewer } from '@/viewer-read-only';
import { useCaseEditor } from './case-editor';
import { Card } from './card';
import { GrossMarginField, ServeFields } from './figures-form';
import { formatMoney, formatNumber } from './format';
import { issueAt, issuesWithin, messagesUnder, settleHidden, useLastValid } from './issues';
import {
  BothSides, finiteNumbers, HowSure, OptionsChart, OptionsTable, OurCallouts, OurStats, OurYearTable, ourView, partnerName, vendorName,
} from './our-case';
import { costGroups, OurCostLinesForm } from './our-cost-lines';
import { partnerKind, roleLines } from './role-lines';
import { SourceOptions, SourceSelect } from './source-select';

const MAX_REASONS = 10;
const newStrategicId = () => `reason_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

/** Text inputs and selects: the height of the number inputs, so a row lines up. */
const control = cn(fieldControl, 'h-9 py-0 aria-invalid:border-danger');
/** Two fields side by side where both labels fit on one line (inside an @container); on a phone they stack. */
const PAIR = 'grid grid-cols-1 items-start gap-3 @min-[340px]:grid-cols-2';
const NOTE = 'rounded-lg bg-surface-2 px-3 py-2 text-[13px] break-words text-ink-2';
const HEADING = 'whitespace-nowrap text-xs font-medium text-ink-3';

type ReasonKey = 'efficiency' | 'churn';
/** The reasons beyond revenue (spec §7.1 item 4), each simplified (a value a year) or detailed (its parts). */
const REASONS: Record<ReasonKey, { name: string; simple: string; detail: string[] }> = {
  efficiency: { name: 'More efficient', simple: 'Worth a year', detail: ['hours', 'rate'] },
  churn: { name: 'Less churn', simple: 'Revenue kept a year', detail: ['customers', 'revenue', 'now', 'withPartner'] },
};

/** A select under a one-line label, the height of the other controls. `label` names it for screen readers. */
function SelectField({ id, label, shown = label, value, onChange, children }: {
  id: string; label: string; shown?: string; value: string; onChange: (v: string) => void; children: ReactNode;
}) {
  return (
    <Field label={shown}>
      {() => (
        <select id={id} aria-label={label === shown ? undefined : label} className={control} value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
      )}
    </Field>
  );
}

const YEARS = [1, 2, 3, 4, 5] as const;
const yearOptions = YEARS.map((y) => <option key={y} value={y}>{`Year ${y}`}</option>);

/** A checkbox in a pair of fields: side by side, an empty label line above it lines it up with the control beside it. */
function CheckField({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="grid content-start gap-1">
      <span aria-hidden className="hidden text-xs leading-4 @min-[340px]:block">&nbsp;</span>
      <label htmlFor={id} className="flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink">
        <input id={id} type="checkbox" className="size-4 shrink-0 accent-brand-strong" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    </div>
  );
}

/** Two options as a segmented control, such as Simplified and Detailed. */
function Segmented<T extends string>({ label, options, value, onPick }: {
  label: string; options: [T, string][]; value: T; onPick: (v: T) => void;
}) {
  // A company server's viewer reads the choice, closed: no hover (owner, 2026-11-14).
  const viewer = useViewer();
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 overflow-hidden rounded-[9px] border border-line">
      {options.map(([v, text], i) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onPick(v)}
          className={cn('h-7 px-2.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
            i > 0 && 'border-l border-line', value === v ? 'bg-brand-strong text-on-brand' : cn('bg-surface text-ink-2', !viewer && 'hover:bg-surface-2'))}>
          {text}
        </button>
      ))}
    </div>
  );
}

const MODES: ['simple' | 'detailed', string][] = [['simple', 'Simplified'], ['detailed', 'Detailed']];

/**
 * Our case (tab 3 of a case, BC v2 section 7): our inputs on the left, what the partnership is worth to us on the right,
 * worked out in the browser on every change from the case and the partner case's result. Internal: the banner says so,
 * and none of it reaches the partner's page. It edits the case on screen, the same case as the other tabs (the case's
 * layout holds the one editor and its autosave). A change that hides fields (a reason switched off, Simplified or
 * Detailed, do it alone's mode) keeps their values, and puts a mistake left in them back to the last right value, so a
 * mistake the owner can no longer see never stops a save.
 */
export function OurCaseTab() {
  const { case: c, latest, update } = useCaseEditor();
  // A company server's viewer reads our case, closed, with no Add a reason or Remove (owner, 2026-11-14).
  const viewer = useViewer();
  const issues = useMemo(() => {
    const parsed = parseCase(c);
    return parsed.ok ? [] : parsed.issues;
  }, [c]);
  const lastValid = useLastValid(c, issues.length === 0);
  const offer = c.offer;
  const o = c.ours;
  const type = offer.types.find((t) => t.id === c.typeId);
  const forSums = useMemo(() => finiteNumbers(c), [c]);
  const view = useMemo(() => (type ? ourView(forSums) : null), [type, forSums]);
  const money = (n: number) => formatMoney(n, offer.currency);
  const partner = partnerName(c);
  const vendor = vendorName(c);
  const at = (path: string) => issueAt(issues, path);

  const setOurs = (patch: Partial<OurCase>) => update({ ...latest(), ours: { ...latest().ours, ...patch } });
  /** A change that hides the fields under `hidden`: a mistake left there is put right (settleHidden). */
  const setHiding = (patch: Partial<OurCase>, hidden: string[]) => {
    const next = { ...latest(), ours: { ...latest().ours, ...patch } };
    const parsed = parseCase(next);
    update(parsed.ok ? next : settleHidden(next, hidden, parsed.issues, lastValid.current));
  };

  const setReason = <K extends ReasonKey>(key: K, patch: Partial<OurCase[K]>) => setOurs({ [key]: { ...latest().ours[key], ...patch } });
  const switchReason = (key: ReasonKey, on: boolean) =>
    setHiding({ [key]: { ...latest().ours[key], on } }, on ? [] : [`ours.${key}`]);
  const switchReasonMode = (key: ReasonKey, mode: 'simple' | 'detailed') =>
    setHiding({ [key]: { ...latest().ours[key], mode } },
      mode === 'detailed' ? [`ours.${key}.simple`] : REASONS[key].detail.map((f) => `ours.${key}.${f}`));

  const setAlone = (patch: Partial<Alone>) => setOurs({ alone: { ...latest().ours.alone, ...patch } });
  const switchAloneMode = (mode: Alone['mode']) =>
    setHiding({ alone: { ...latest().ours.alone, mode } },
      mode === 'detailed' ? ['ours.alone.share', 'ours.alone.setup', 'ours.alone.fixed'] : ['ours.alone.deals', 'ours.alone.costs']);

  const setReasonRow = (id: string, patch: Partial<StrategicReason>) =>
    setOurs({ strategic: latest().ours.strategic.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  /** Reasons added here and not yet left: their "write the reason" waits until the owner leaves the field. */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  /** The reason just added, focused once its field is there. */
  const focusReason = useRef<string | null>(null);
  const addReasonRow = () => {
    const id = newStrategicId();
    focusReason.current = id;
    setFresh((ids) => new Set(ids).add(id));
    setOurs({ strategic: [...latest().ours.strategic, { id, text: '', weight: 'medium', alone: false }] });
  };
  const leaveReason = (id: string) => setFresh((ids) => {
    if (!ids.has(id)) return ids;
    const next = new Set(ids);
    next.delete(id);
    return next;
  });
  const removeReasonRow = (id: string) => setOurs({ strategic: latest().ours.strategic.filter((s) => s.id !== id) });

  // Notes beside the inputs, from the numbers as they are now.
  const lines = (list: OurCase['costs'], when: 'start' | 'yearly' | 'preferred') => list.filter((l) => l.when === when).reduce((s, l) => s + l.amount, 0);
  const prefCost = offer.preferred.on ? lines(forSums.ours.costs, 'preferred') : 0;
  const costNote = `${money(lines(forSums.ours.costs, 'start'))} to get started, then ${money(lines(forSums.ours.costs, 'yearly'))} every year${prefCost > 0 ? `, plus ${money(prefCost)} a year while ${partner} is ${offer.levels.preferred}` : ''}.`;
  const A = forSums.ours.alone;
  const aloneNote = view
    ? `Alone: about ${view.ours.alone.deals.map((d) => formatNumber(Math.round(d))).join(', ')} new deals a year. ${money(A.mode === 'simple' ? A.setup : lines(A.costs, 'start'))} to start, then ${money(A.mode === 'simple' ? A.fixed : lines(A.costs, 'yearly'))} every year, plus our own sales, support and services for every customer.`
    : null;
  const revenueNote = view
    ? `Over ${view.ours.years.length} years, ${partner} brings ${money(view.partner.vendorRevenue)} in revenue. The partner’s ${view.partner.word} is ${money(view.partner.earnings)} of that.`
    : null;
  const whoDoesWhat = type ? `${type.name}: ${roleLines(type.roles, c.partner.trim() || 'The partner', offer.company.trim() || 'You').join('; ')}.` : null;

  const formula = (key: ReasonKey): string => {
    if (key === 'efficiency') {
      const e = forSums.ours.efficiency;
      return `${formatNumber(e.hours)} hours × ${money(e.rate)} = ${money(e.hours * e.rate)} a year.`;
    }
    const ch = forSums.ours.churn;
    const value = (ch.customers * Math.max(0, ch.now - ch.withPartner) / 100) * ch.revenue;
    return `${formatNumber(ch.customers)} customers × (${formatNumber(ch.now)}% − ${formatNumber(ch.withPartner)}%) × ${money(ch.revenue)} = ${money(value)} a year.`;
  };

  const reasonCard = (key: ReasonKey) => {
    const R = REASONS[key];
    const d = o[key];
    const id = `ours-${key}`;
    const path = `ours.${key}`;
    const amount = (field: string, label: string, kind: 'money' | 'number' | 'percent') => {
      const value = (d as unknown as Record<string, number>)[field] ?? 0;
      const props = { id: `${id}-${field}`, label, value, error: at(`${path}.${field}`), onChange: (n: number) => setReason(key, { [field]: n } as Partial<Efficiency & Churn>) };
      if (kind === 'money') return <MoneyInput key={field} {...props} currency={offer.currency} />;
      if (kind === 'percent') return <PercentInput key={field} {...props} />;
      return <NumberInput key={field} {...props} />;
    };
    const from = (
      <SelectField key="from" id={`${id}-from`} label={`${R.name} from`} shown="From" value={String(d.from)}
        onChange={(v) => setReason(key, { from: Number(v) as Efficiency['from'] })}>
        {yearOptions}
      </SelectField>
    );
    const detail = key === 'efficiency'
      ? [[amount('hours', 'Hours freed a year', 'number'), amount('rate', 'Cost per hour', 'money')], [from]]
      : [[amount('customers', 'Customers affected', 'number'), amount('revenue', 'Revenue per customer a year', 'money')],
        [amount('now', 'Churn today', 'percent'), amount('withPartner', 'Churn with the partner', 'percent')], [from]];
    return (
      <div key={key} className={cn('rounded-[10px] border border-line px-3 py-2.5', !d.on && 'bg-surface-2')}>
        <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-on`} className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink">
            <input id={`${id}-on`} type="checkbox" className="size-4 shrink-0 accent-brand-strong" checked={d.on} onChange={(e) => switchReason(key, e.target.checked)} />
            {R.name}
          </label>
          {d.on && <Segmented label={`${R.name}: how`} options={MODES} value={d.mode} onPick={(mode) => switchReasonMode(key, mode)} />}
        </div>
        {d.on && (
          <div className="@container mt-2.5 grid gap-3">
            {d.mode === 'simple' ? (
              <div className={PAIR}>{amount('simple', R.simple, 'money')}{from}</div>
            ) : (
              <>
                {detail.map((pair, i) => <div key={i} className={PAIR}>{pair}</div>)}
                <p className={cn(NOTE, 'tabular-nums')}>{formula(key)}</p>
              </>
            )}
            <div className={PAIR}>
              <SelectField id={`${id}-source`} label={`${R.name} source`} shown="Source" value={d.source} onChange={(v) => setReason(key, { source: v as Source })}>
                <SourceOptions />
              </SelectField>
              <CheckField id={`${id}-alone`} label="Also if we go alone" checked={d.alone} onChange={(alone) => setReason(key, { alone })} />
            </div>
            <Field label="Note" error={at(`${path}.note`)}>
              {(describedBy) => (
                <input id={`${id}-note`} aria-label={`${R.name} note`} className={control} value={d.note} maxLength={200} placeholder="Where the number comes from"
                  aria-describedby={describedBy} onChange={(e) => setReason(key, { note: e.target.value })} />
              )}
            </Field>
          </div>
        )}
      </div>
    );
  };

  const aloneDealIssues = [0, 1, 2, 3, 4].map((i) => at(`ours.alone.deals.${i}`)).filter((m): m is string => Boolean(m));

  return (
    <>
      <div>
        <p className="rounded-[10px] border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] break-words text-warn">
          {`Internal. Never shared with ${partner} and never part of the partner’s link.`}
        </p>
        {!type && <p role="alert" className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm font-medium text-warn">This case’s partner type is no longer in its offer.</p>}

        <div className="mt-3.5 grid items-start gap-5 min-[1000px]:grid-cols-[460px_minmax(0,1fr)]">
          <ClosedForViewer>
          <div className="grid min-w-0 gap-3.5">
            <Card id="revenue" title={`Revenue through ${partner}`} hint="Deals, products and terms come from the partner’s case.">
              {revenueNote && <p className={cn(NOTE, 'mb-3.5')}>{revenueNote}</p>}
              <div className="@container grid gap-3">
                <div className={PAIR}>
                  <GrossMarginField figures={o.figures} onChange={(figures) => setOurs({ figures })} issues={issuesWithin(issues, 'ours.figures')} />
                  <div className="min-w-0">
                    <PercentInput id="ours-anyway" label="Deals we’d win anyway" caption="On these we only pay the partner’s share" value={o.anyway}
                      error={at('ours.anyway')} onChange={(anyway) => setOurs({ anyway })} />
                    <SourceSelect id="ours-anyway-source" label="Deals we’d win anyway source" value={o.anywaySource} onChange={(anywaySource) => setOurs({ anywaySource })} />
                  </div>
                </div>
                <div className={PAIR}>
                  <SelectField id="ours-deals-source" label="The deal plan comes from" value={o.dealsSource} onChange={(v) => setOurs({ dealsSource: v as Source })}>
                    <SourceOptions />
                  </SelectField>
                </div>
              </div>
            </Card>

            <Card id="serve" title="Winning and serving a customer yourself"
              hint="What a customer costs you without a partner. The partner type decides which parts the partner takes over.">
              <ServeFields figures={o.figures} onChange={(figures) => setOurs({ figures })} issues={issuesWithin(issues, 'ours.figures')} currency={offer.currency} />
              {whoDoesWhat && <p className={cn(NOTE, 'mt-3')}>{whoDoesWhat}</p>}
            </Card>

            <Card id="our-costs" title="Your costs" hint="Our own investment in this partner, and where each number comes from.">
              <OurCostLinesForm lines={o.costs} onChange={(costs) => setOurs({ costs })} issues={issuesWithin(issues, 'ours.costs')}
                groups={costGroups(offer.preferred.on)} currency={offer.currency} higher={offer.levels.preferred} />
              <p className={cn(NOTE, 'mt-3')}>{costNote}</p>
            </Card>

            <Card id="beyond" title="Beyond revenue" hint="Simplified when you only have an estimate. Detailed when finance or sales can give you the parts.">
              <div className="grid gap-2.5">{(['efficiency', 'churn'] as const).map(reasonCard)}</div>
            </Card>

            <Card id="strategic" title="Strategic reasons" hint="What can’t honestly be put in money, and how much it matters.">
              {o.strategic.length > 0 && (
                <div aria-hidden className="mb-1 grid grid-cols-[minmax(0,1fr)_96px_64px_28px] gap-1.5">
                  <span data-label className={HEADING}>Reason</span>
                  <span data-label className={HEADING}>Matters</span>
                  <span data-label className={cn(HEADING, 'text-center')}>Alone too</span>
                  <span />
                </div>
              )}
              {o.strategic.map((s, i) => {
                const shown = !fresh.has(s.id);
                const rowIssues = shown ? messagesUnder(issues, `ours.strategic.${i}`) : [];
                const issueId = rowIssues.length > 0 ? `reason-${s.id}-issues` : undefined;
                return (
                  <div key={s.id} className="mb-1.5">
                    <div className="grid grid-cols-[minmax(0,1fr)_96px_64px_28px] items-center gap-1.5">
                      <input id={`reason-${s.id}-text`} aria-label="Strategic reason" className={control} value={s.text} maxLength={200}
                        aria-invalid={shown && at(`ours.strategic.${i}.text`) ? true : undefined} aria-describedby={issueId}
                        ref={(el) => {
                          if (el && focusReason.current === s.id) {
                            focusReason.current = null;
                            el.focus();
                          }
                        }}
                        onBlur={() => leaveReason(s.id)} onChange={(e) => setReasonRow(s.id, { text: e.target.value })} />
                      <select id={`reason-${s.id}-weight`} aria-label="How much it matters" className={control} value={s.weight}
                        onChange={(e) => setReasonRow(s.id, { weight: e.target.value as StrategicReason['weight'] })}>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                      <span className="flex h-9 items-center justify-center">
                        <input type="checkbox" aria-label="Also if we go alone" className="size-4 accent-brand-strong" checked={s.alone}
                          onChange={(e) => setReasonRow(s.id, { alone: e.target.checked })} />
                      </span>
                      {!viewer && (
                        <Button variant="ghost" size="icon" className="h-9 w-7 text-ink-3 hover:bg-transparent hover:text-danger"
                          aria-label="Remove this reason" onClick={() => removeReasonRow(s.id)}>
                          <X aria-hidden className="size-4" />
                        </Button>
                      )}
                    </div>
                    {issueId && <p id={issueId} className="mt-1 text-xs text-danger">{rowIssues.join(' ')}</p>}
                  </div>
                );
              })}
              {!viewer && <Button size="sm" disabled={o.strategic.length >= MAX_REASONS} onClick={addReasonRow}>Add a reason</Button>}
              {at('ours.strategic') && <p className="mt-1 text-xs text-danger">{at('ours.strategic')}</p>}
            </Card>

            <Card id="alternatives" title="The alternatives" hint="The partnership is judged against doing it ourselves, and against doing nothing.">
              <div className="@container">
                <div className="mb-2.5 flex min-h-[30px] flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[13.5px] font-semibold">Do it alone</h3>
                  <Segmented label="Do it alone: how" options={MODES} value={o.alone.mode} onPick={switchAloneMode} />
                </div>
                {o.alone.mode === 'simple' ? (
                  <div className="grid gap-3">
                    <div className={PAIR}>
                      <PercentInput id="ours-alone-share" label="Deals we’d close ourselves" caption="Compared with the partner’s plan" value={o.alone.share}
                        error={at('ours.alone.share')} onChange={(share) => setAlone({ share })} />
                      <NumberInput id="ours-alone-delay" label="Starting later by" unit="months" caption="Hiring and set-up before the first deal" value={o.alone.delay}
                        error={at('ours.alone.delay')} onChange={(delay) => setAlone({ delay })} />
                    </div>
                    <div className={PAIR}>
                      <MoneyInput id="ours-alone-setup" label="Set-up cost" currency={offer.currency} value={o.alone.setup}
                        error={at('ours.alone.setup')} onChange={(setup) => setAlone({ setup })} />
                      <MoneyInput id="ours-alone-fixed" label="Fixed cost every year" currency={offer.currency} value={o.alone.fixed}
                        caption="Team and office. Sales, support and services per customer are added from the card above"
                        error={at('ours.alone.fixed')} onChange={(fixed) => setAlone({ fixed })} />
                    </div>
                    <div className={PAIR}>
                      <SelectField id="ours-alone-source" label="Alone source" shown="Source" value={o.alone.source} onChange={(v) => setAlone({ source: v as Source })}>
                        <SourceOptions />
                      </SelectField>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <div role="group" aria-labelledby="alone-deals-label">
                      <span id="alone-deals-label" data-label className={cn(HEADING, 'mb-1 block')}>Deals we’d close ourselves, before the delay</span>
                      <div className="grid grid-cols-5 items-start gap-1.5">
                        {o.alone.deals.map((d, i) => (
                          <div key={i} className="grid min-w-0 content-start gap-1">
                            <span aria-hidden data-label className={cn(HEADING, 'text-center')}>{`Year ${i + 1}`}</span>
                            <NumberInput id={`ours-alone-deals-${i + 1}`} label={`Deals alone, year ${i + 1}`} labelHidden align="center" value={d}
                              invalid={Boolean(at(`ours.alone.deals.${i}`))} describedBy={aloneDealIssues.length > 0 ? 'alone-deal-issues' : undefined}
                              onChange={(n) => setAlone({ deals: latest().ours.alone.deals.map((x, j) => (j === i ? n : x)) as Alone['deals'] })} />
                          </div>
                        ))}
                      </div>
                      {aloneDealIssues.length > 0 && <p id="alone-deal-issues" className="mt-1 text-xs text-danger">{aloneDealIssues.join(' ')}</p>}
                    </div>
                    <div className={PAIR}>
                      <NumberInput id="ours-alone-delay" label="Starting later by" unit="months" value={o.alone.delay}
                        error={at('ours.alone.delay')} onChange={(delay) => setAlone({ delay })} />
                      <SelectField id="ours-alone-source" label="Source of the deals" value={o.alone.source} onChange={(v) => setAlone({ source: v as Source })}>
                        <SourceOptions />
                      </SelectField>
                    </div>
                    <OurCostLinesForm lines={o.alone.costs} onChange={(costs) => setAlone({ costs })} issues={issuesWithin(issues, 'ours.alone.costs')}
                      groups={['start', 'yearly']} currency={offer.currency} />
                  </div>
                )}
                {aloneNote && <p className={cn(NOTE, 'mt-3 tabular-nums')}>{aloneNote}</p>}
              </div>

              <div className="@container mt-4 border-t border-line pt-3.5">
                <h3 className="text-[13.5px] font-semibold">Don’t do it</h3>
                <p className="mt-0.5 mb-2.5 text-xs text-ink-3">Doing nothing costs nothing up front, but it isn’t always safe.</p>
                <div className="grid gap-3">
                  <div className={PAIR}>
                    <div className="min-w-0">
                      <MoneyInput id="ours-risk-amount" label="Revenue at risk a year" currency={offer.currency} value={o.risk.amount}
                        error={at('ours.risk.amount')} onChange={(amount) => setOurs({ risk: { ...latest().ours.risk, amount } })} />
                      <SourceSelect id="ours-risk-source" label="Revenue at risk source" value={o.risk.source}
                        onChange={(source) => setOurs({ risk: { ...latest().ours.risk, source } })} />
                    </div>
                    <SelectField id="ours-risk-from" label="Revenue at risk from" shown="From" value={String(o.risk.from)}
                      onChange={(v) => setOurs({ risk: { ...latest().ours.risk, from: Number(v) as OurCase['risk']['from'] } })}>
                      {yearOptions}
                    </SelectField>
                  </div>
                  <Field label="Why" error={at('ours.risk.why')}>
                    {(describedBy) => (
                      <input id="ours-risk-why" className={control} value={o.risk.why} maxLength={200} placeholder="For example: a competitor’s partner takes our renewals"
                        aria-describedby={describedBy} onChange={(e) => setOurs({ risk: { ...latest().ours.risk, why: e.target.value } })} />
                    )}
                  </Field>
                </div>
              </div>
            </Card>

            <Card id="manager" title="For your manager" hint="Shown on the internal one-pager.">
              <div className="grid gap-3">
                <Field label="Your recommendation" error={at('ours.recommendation')}>
                  {(describedBy) => (
                    <textarea id="ours-recommendation" className={cn(fieldControl, 'min-h-16 resize-y')} value={o.recommendation} maxLength={1000}
                      placeholder="Leave empty to show only what the numbers say" aria-describedby={describedBy}
                      onChange={(e) => setOurs({ recommendation: e.target.value })} />
                  )}
                </Field>
                <Field label="What you ask for, besides the costs" error={at('ours.ask')}>
                  {(describedBy) => (
                    <textarea id="ours-ask" className={cn(fieldControl, 'min-h-16 resize-y')} value={o.ask} maxLength={1000}
                      placeholder="For example: a partner manager, half time" aria-describedby={describedBy}
                      onChange={(e) => setOurs({ ask: e.target.value })} />
                  )}
                </Field>
                <Field label="Prepared by" error={at('ours.preparedBy')}>
                  {(describedBy) => (
                    <input id="ours-prepared-by" className={control} value={o.preparedBy} maxLength={80} placeholder="Your name"
                      aria-describedby={describedBy} onChange={(e) => setOurs({ preparedBy: e.target.value })} />
                  )}
                </Field>
              </div>
            </Card>
          </div>
          </ClosedForViewer>

          <div className="min-w-0">
            <h2 className="text-lg leading-tight font-semibold tracking-tight break-words">{`Is the partnership with ${partner} worth it for ${vendor}?`}</h2>
            {view && type && (
              <>
                <p className="mt-1 mb-3.5 text-xs text-ink-3">
                  {`${partnerKind(type.name)}, ${view.ours.years.length} years, ${c.scenario} scenario, the same deals as the partner’s case.`}
                </p>
                <div className="mb-3.5"><OurStats view={view} /></div>
                <div className="mb-3.5"><OurCallouts view={view} /></div>
                <div className="grid gap-3.5">
                  <Card id="both-sides" title="Good for both sides?" hint="The partner’s profit from the partner case, next to ours.">
                    <BothSides view={view} />
                  </Card>
                  <Card id="options" title="The options" hint="Net value so far, after costs, for each option.">
                    <OptionsChart view={view} />
                    <div className="mt-3.5"><OptionsTable view={view} /></div>
                  </Card>
                  <Card id="how-sure" title="How sure are these numbers?" hint="Every number in the result, by where it comes from.">
                    <HowSure view={view} />
                  </Card>
                  <Card id="our-years" title={`Year by year, with ${partner}`}>
                    <OurYearTable view={view} />
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
