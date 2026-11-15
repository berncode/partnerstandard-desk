'use client';

// The partner case's form (PartnerCaseForm) and how a case is saved. PartnerStandard Desk keeps one editor for the whole case
// in the case's layout, as for programs (src/programs/program-editor.tsx), so every tab shows and changes the same case with
// one save at a time; it saves through `caseSave` with the case as last read or saved (`base`). The partner type is fixed
// for a case (spec 5.2), so it is shown, not picked. The level names are the case's own (`offer.levels`) where the Business
// Case app wrote Registered and Preferred. It uses PartnerStandard Desk's autosave and number inputs; a number still being
// typed in the offer counts as 0 here too.
import {
  CASE_BENEFITS as BENEFITS, leadShare, parseCase, simulateCase, type BusinessCase as Case, type CaseType, type CostLine, type Roles,
  type Scenario, type Tier,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RemoteResult } from '@/editor/remote';
import { Field, fieldControl } from '@/programs/field';
import { MoneyInput } from '@/programs/money-input';
import { NumberInput } from '@/programs/number-input';
import { PercentInput } from '@/programs/percent-input';
import { SaveStatusLine } from '@/programs/save-status';
import { useAutosave, type SaveOutcome, type SaveStatus } from '@/programs/use-autosave';
import { useViewer } from '@/storage-context';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ClosedForViewer } from '@/viewer-read-only';
import { Card } from './card';
import { formatMoney, formatNumber } from './format';
import { describeTypicalCustomer, ResultSummary } from './result-summary';
import { RevenueChart } from './revenue-chart';
import { partnerKind, roleLines } from './role-lines';
import { YearTable } from './year-table';

// ---------------------------------------------------------------------------------------------------------------------
// The editor

/** What a save sends: the case on screen, the case as last read or saved, and its Updated. */
export interface CaseSaveInput {
  caseId: string;
  case: Case;
  base: Case;
  expectedUpdatedAt: string | null;
}
export type SaveCase = (input: CaseSaveInput) => Promise<RemoteResult<Case>>;

export interface CaseEditorState {
  /** The case as it is on screen. */
  case: Case;
  status: SaveStatus;
  /** Puts `next` on screen and saves it 800 ms after the last change. */
  update: (next: Case) => void;
  /** The case as it is now, also inside a handler that runs before the next render. */
  latest: () => Case;
  /** Saves what isn't saved yet now; resolves once it is, or with why it isn't. */
  saveNow: () => Promise<SaveOutcome>;
  /** The case as last saved: what an Update goes over. */
  stored: () => Case;
  /**
   * The file holds `saved` now, written by another action on this screen (sharing stamps the case): the next save goes
   * over it, so it isn't refused as a change made somewhere else. What is on screen stays.
   */
  adopt: (saved: Case) => void;
  retry: () => void;
  /** Reload after saving stopped: the file's latest case replaces the screen. */
  reload: () => void;
}

const EditorContext = createContext<CaseEditorState | null>(null);

/** The case on screen and how to change it. Only inside CaseEditor. */
export function useCaseEditor(): CaseEditorState {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useCaseEditor needs CaseEditor around the tab');
  return editor;
}

/**
 * Refusals saving again can't get past: the file changed since it was read (in the app, by an Update, or by hand in the
 * sheet), the sign-in or the file is gone, or no access. Saving stops and Reload brings the latest.
 */
const STOPS = new Set(['conflict', 'auth', 'file_not_found', 'forbidden']);

/**
 * One case being edited, around all its tabs (the case's layout keeps it while the tabs change, so there is one save
 * at a time for the whole case). A change is saved 800 ms after the last one, never with a mistake in it, with the case
 * as last read or saved (`base`) and its Updated, so a case changed somewhere else (another browser tab, an Update, or
 * a hand edit in the sheet) is never overwritten: saving stops and Reload shows the latest (Review Focus 4).
 */
export function CaseEditor({ initial, save, children }: { initial: Case; save: SaveCase; children: ReactNode }) {
  const router = useRouter();
  /** The case as the file holds it: what the next save goes over. */
  const base = useRef(initial);
  // A company server's viewer reads the case and changes nothing (owner, 2026-11-14): nothing they do is saved.
  const viewer = useViewer();
  const autosave = useAutosave<Case, RemoteResult<Case>>({
    initial,
    readOnly: viewer,
    prepare: (sent) => {
      const parsed = parseCase(sent);
      return parsed.ok ? { ok: true, value: parsed.case } : { ok: false, message: parsed.issues[0]!.message };
    },
    save: async (c) => {
      const result = await save({ caseId: initial.id, case: c, base: base.current, expectedUpdatedAt: base.current.updatedAt || null });
      if (result.ok) {
        base.current = result.snapshot.value;
        return result;
      }
      return result.error === 'conflict' ? { ...result, message: COPY.CHANGED_SOMEWHERE_ELSE } : result;
    },
    stops: (result) => !result.ok && STOPS.has(result.error),
  });
  const state: CaseEditorState = {
    case: autosave.value,
    status: autosave.status,
    update: autosave.update,
    latest: autosave.latest,
    saveNow: autosave.flush,
    stored: () => base.current,
    adopt: (saved) => {
      base.current = saved;
    },
    retry: () => void autosave.flush(),
    reload: () => router.refresh(),
  };
  return <EditorContext value={state}>{children}</EditorContext>;
}

/** What the case's autosave is doing, with Try again and Reload. */
export function CaseSaveStatus({ className }: { className?: string }) {
  const { status, retry, reload } = useCaseEditor();
  return <SaveStatusLine className={className} status={status} retry={retry} reload={reload} />;
}

// ---------------------------------------------------------------------------------------------------------------------
// The partner case

const MAX_COSTS = 20;
const MAX_BENEFITS = 4;
const DEFAULT_GROWTH = 40;

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: 'careful', label: 'Careful' },
  { value: 'expected', label: 'Expected' },
  { value: 'ambitious', label: 'Ambitious' },
];

/** Text inputs and selects: the height of the number inputs, so a row lines up. */
const control = cn(fieldControl, 'h-9 py-0 aria-invalid:border-danger');
const heading = 'whitespace-nowrap text-xs font-medium text-ink-3';
/**
 * A cost line: name, amount and Remove side by side where they fit. In a narrow card (a phone) the name gets the whole
 * line with Remove, and the amount goes under it, so a name like "Sales and technical training" isn't cut off.
 */
const COST_ROW = 'grid grid-cols-[minmax(0,1fr)_28px] items-center gap-1.5 @min-[360px]:grid-cols-[minmax(0,1fr)_124px_28px]';

const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const newCostId = () => `cost_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

/**
 * The case with every number still being typed counted as 0, so the result never shows NaN. In PartnerStandard Desk the offer
 * tab shares the case on screen, so the offer's numbers are counted the same way.
 */
export function forResult(c: Case): Case {
  const rates = (r: CaseType['registered']) => ({ first: finite(r.first), renewal: finite(r.renewal), once: finite(r.once), servicesShare: finite(r.servicesShare) });
  return {
    ...c,
    deals: c.deals.map(finite) as Case['deals'],
    implementation: finite(c.implementation),
    managed: finite(c.managed),
    other: finite(c.other),
    serviceProfit: finite(c.serviceProfit),
    supportCost: finite(c.supportCost),
    costs: c.costs.map((x) => ({ ...x, amount: finite(x.amount) })),
    offer: {
      ...c.offer,
      renewal: finite(c.offer.renewal),
      preferred: { ...c.offer.preferred, deals: finite(c.offer.preferred.deals), revenue: finite(c.offer.preferred.revenue) },
      products: c.offer.products.map((p) => ({ ...p, price: finite(p.price), amount: finite(p.amount) })),
      types: c.offer.types.map((t) => ({
        ...t, roles: { ...t.roles, lead: finite(t.roles.lead) }, registered: rates(t.registered), preferred: rates(t.preferred), fee: finite(t.fee),
      })),
    },
  };
}

/** What the deals are (BC v2 section 4): deals the partner closes, customers it serves while the vendor closes, or referrals. */
function dealsCard(roles: Roles): { title: string; hint: string } {
  if (roles.closes) return { title: 'Deals the partner expects to close', hint: 'Most partners start slowly: the first deals usually come after a few months.' };
  if (roles.services) {
    const lead = Math.round(leadShare(roles) * 100);
    return { title: 'New customers the partner serves', hint: `The partner found ${lead}% of these customers itself. Your team closes every deal.` };
  }
  return { title: 'Deals from the partner’s referrals', hint: 'Your sales team closes the deals the partner introduces.' };
}

/**
 * ", plus 10% of Northwind’s services to Acme" for the cost note, per level when they differ while Preferred is on
 * (", plus 10% of … as Registered, 5% as Preferred", a level at 0% left out), or '' when the vendor takes none of it.
 */
function shareOfServices(type: CaseType, preferredOn: boolean, of: string, levels: Case['offer']['levels']): string {
  const [registered, preferred] = [finite(type.registered.servicesShare), finite(type.preferred.servicesShare)];
  const tiers = !preferredOn || registered === preferred
    ? [{ pct: registered, as: '' }]
    : [{ pct: registered, as: ` as ${levels.registered}` }, { pct: preferred, as: ` as ${levels.preferred}` }];
  const shown = tiers.filter((t) => t.pct > 0).map((t, i) => `${formatNumber(t.pct)}%${i === 0 ? ` of ${of}` : ''}${t.as}`);
  return shown.length > 0 ? `, plus ${shown.join(', ')}` : '';
}

/** The partner case tab: the form for the case on screen. */
export function PartnerCaseTab() {
  const { case: c, latest, update } = useCaseEditor();
  return <PartnerCaseForm value={c} latest={latest} update={update} />;
}

/**
 * The partner case (tab 2 of a case): the inputs on the left, the result on the right, worked out in the browser on
 * every change from the case's own offer. The partner type's roles decide what the deals are, whether the partner
 * business and support cost apply, and the second headline (BC v2 section 4); the case's Preferred conditions decide
 * whether Starts as, the When Preferred costs and the levels show (BC v2 section 6). Fields a type hides keep their
 * values. `latest` is the case as it is now, also inside a handler that runs before the next render; `update` puts a
 * changed case on screen (the editor saves it).
 */
export function PartnerCaseForm({ value: c, latest, update }: { value: Case; latest: () => Case; update: (next: Case) => void }) {
  // A company server's viewer reads the fields, closed, with no Add, Remove or Fill (owner, 2026-11-14).
  const viewer = useViewer();
  const offer = c.offer;
  const levels = offer.levels;
  const preferredOn = offer.preferred.on;
  const [growth, setGrowth] = useState(DEFAULT_GROWTH);
  const [fills, setFills] = useState(0); // a fill shows new numbers in the deal fields, whatever was typed there

  const issues = useMemo(() => {
    const parsed = parseCase(c);
    return parsed.ok ? [] : parsed.issues;
  }, [c]);
  const type = offer.types.find((t) => t.id === c.typeId);
  const forSums = useMemo(() => forResult(c), [c]);
  const result = useMemo(() => (type ? simulateCase(forSums) : null), [type, forSums]);
  const roles = type?.roles;
  const deals = dealsCard(roles ?? { lead: 100, closes: true, support: 'none', services: false });
  const supports = roles !== undefined && roles.support !== 'none';
  const costGroupsAll: { when: CostLine['when']; title: string; caption: string }[] = [
    { when: 'start', title: 'To get started', caption: 'Paid once, in year 1' },
    { when: 'yearly', title: 'Every year', caption: 'From year 1 on' },
    { when: 'preferred', title: `When ${levels.preferred}`, caption: `Every year as a ${levels.preferred} partner` },
  ];

  const set = (patch: Partial<Case>) => update({ ...latest(), ...patch });
  const issueAt = (path: string) => issues.find((i) => i.path === path)?.message;
  const issuesUnder = (prefix: string) => issues.filter((i) => i.path.startsWith(`${prefix}.`)).map((i) => i.message);
  const money = (n: number) => formatMoney(n, offer.currency);

  const partner = c.partner.trim() || 'the partner';
  const whoDoesWhat = roles ? `${roleLines(roles, c.partner.trim() || 'The partner', offer.company.trim() || 'You').join(' · ')}.` : null;
  const setDeal = (i: number, n: number) => set({ deals: latest().deals.map((d, j) => (j === i ? n : d)) as Case['deals'] });
  const fill = () => {
    const first = finite(latest().deals[0]);
    set({ deals: latest().deals.map((_, i) => Math.round(first * (1 + growth / 100) ** i)) as Case['deals'] });
    setFills((n) => n + 1);
  };
  const dealIssues = [0, 1, 2, 3, 4].map((i) => issueAt(`deals.${i}`)).filter((m): m is string => Boolean(m));

  const setCost = (id: string, patch: Partial<CostLine>) =>
    set({ costs: latest().costs.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const addCost = (when: CostLine['when']) =>
    set({ costs: [...latest().costs, { id: newCostId(), name: 'New cost', when, amount: 1000 }] });
  const removeCost = (id: string) => set({ costs: latest().costs.filter((x) => x.id !== id) });
  const costTotal = (when: CostLine['when']) => forSums.costs.filter((x) => x.when === when).reduce((s, x) => s + x.amount, 0);
  const costGroups = costGroupsAll.filter((g) => g.when !== 'preferred' || preferredOn);
  const preferredCost = preferredOn && costTotal('preferred') > 0 ? `, plus ${money(costTotal('preferred'))} a year as ${levels.preferred}` : '';
  const supportCost = supports ? `, plus ${money(forSums.supportCost)} per customer a year for support` : '';
  const vendor = offer.company.trim() || 'you';
  const fee = type && finite(type.fee) > 0 ? `, plus ${money(finite(type.fee))} a year partner fee` : '';
  const servicesShare = type && roles?.services ? shareOfServices(type, preferredOn, `${partner}’s services to ${vendor}`, levels) : '';

  const toggleBenefit = (benefit: (typeof BENEFITS)[number]) => {
    const chosen = latest().benefits;
    set({ benefits: chosen.includes(benefit) ? chosen.filter((b) => b !== benefit) : [...chosen, benefit] });
  };

  return (
    <>
      {!type && <p role="alert" className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm font-medium text-warn">This case’s partner type is no longer in its offer.</p>}

      {/* Side by side from the Business Case app's width (968 px of content at its 1000 px), measured on the content:
          PartnerStandard Desk's sidebar takes part of the window. */}
      <div className="@container">
      <div className="grid items-start gap-5 @min-[968px]:grid-cols-[410px_minmax(0,1fr)]">
        <ClosedForViewer>
        <div className="grid min-w-0 gap-3.5">
          <Card id="partner" title="The partner">
            {/* No field for the partner's name: a case is named as Partners names the partner (owner, 2026-10-30). The
                type keeps half the width, as before. */}
            <div className="grid grid-cols-2 items-start gap-3">
              <Field label="Partner type">
                {() => <input id="case-type" readOnly className={cn(control, 'bg-surface-2 text-ink-2')} value={type?.name ?? ''} />}
              </Field>
            </div>
            {preferredOn && (
              // Half the width, like the fields above; its caption may use the whole line.
              <div className="mt-3">
                <Field label="Starts as" hint={`${levels.preferred} for a partner who already has the tier`}>
                  {(describedBy) => (
                    <select id="case-starts-as" className={cn(control, 'w-[calc(50%-0.375rem)]')} value={c.startsAs} aria-describedby={describedBy}
                      onChange={(e) => set({ startsAs: e.target.value as Tier })}>
                      <option value="registered">{levels.registered}</option>
                      <option value="preferred">{levels.preferred}</option>
                    </select>
                  )}
                </Field>
              </div>
            )}
            {whoDoesWhat && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px] break-words text-ink-2">{whoDoesWhat}</p>}
          </Card>

          <Card id="deals" title={deals.title} hint={deals.hint}>
            <div className="grid grid-cols-5 items-start gap-1.5">
              {c.deals.map((d, i) => (
                <NumberInput key={`${i}-${fills}`} id={`case-deals-${i + 1}`} label={`Year ${i + 1}`} align="center" value={d}
                  invalid={Boolean(issueAt(`deals.${i}`))} describedBy={dealIssues.length > 0 ? 'deal-issues' : undefined}
                  onChange={(n) => setDeal(i, n)} />
              ))}
            </div>
            {dealIssues.length > 0 && <p id="deal-issues" className="mt-1 text-xs text-danger">{dealIssues.join(' ')}</p>}
            {viewer ? <div className="mb-3.5" /> : (
              <div className="mt-3 mb-3.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
                <span>Fill from year 1, growing</span>
                <PercentInput id="case-growth" label="Growth a year" labelHidden value={growth} onChange={setGrowth}
                  className="w-[86px]" invalid={!Number.isFinite(growth)} />
                <span>a year</span>
                <Button size="sm" disabled={!Number.isFinite(growth)} onClick={fill}>Fill</Button>
              </div>
            )}
            <div role="group" aria-labelledby="scenario-label" className="grid justify-items-start gap-1">
              <span id="scenario-label" data-label className={heading}>Scenario</span>
              <div className="inline-flex overflow-hidden rounded-[9px] border border-line">
                {SCENARIOS.map((s, i) => (
                  <button key={s.value} type="button" aria-pressed={c.scenario === s.value} onClick={() => set({ scenario: s.value })}
                    className={cn('h-[34px] px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
                      i > 0 && 'border-l border-line',
                      c.scenario === s.value ? 'bg-brand-strong text-on-brand' : cn('bg-surface text-ink-2', !viewer && 'hover:bg-surface-2'))}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {roles?.services && (
            <Card id="business" title="Partner business around each deal" hint="What the partner sells on top of your product. Often more than what you pay the partner.">
              <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3">
                <MoneyInput id="case-implementation" label="Implementation" caption="per new customer" currency={offer.currency}
                  value={c.implementation} error={issueAt('implementation')} onChange={(n) => set({ implementation: n })} />
                <MoneyInput id="case-managed" label="Managed service" caption="per customer and month" currency={offer.currency}
                  value={c.managed} error={issueAt('managed')} onChange={(n) => set({ managed: n })} />
                <MoneyInput id="case-other" label="Other sales" caption="per new customer" currency={offer.currency}
                  value={c.other} error={issueAt('other')} onChange={(n) => set({ other: n })} />
                <div className="min-w-0 sm:col-start-1">
                  <PercentInput id="case-service-profit" label="Partner profit on it" value={c.serviceProfit}
                    error={issueAt('serviceProfit')} onChange={(n) => set({ serviceProfit: n })} />
                </div>
              </div>
            </Card>
          )}

          <Card id="costs" title="What it costs the partner" hint="So the case is honest: when does the partnership pay for itself?">
            <div className="@container">
            {costGroups.map((group) => {
              const lines = c.costs.map((x, index) => ({ x, index })).filter(({ x }) => x.when === group.when);
              const groupId = `costs-${group.when}`;
              return (
                <div key={group.when} role="group" aria-labelledby={`${groupId}-heading`} className="mt-3.5 first:mt-0">
                  <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink-2">
                    <span id={`${groupId}-heading`}>{group.title}</span>
                    <span className="font-normal text-ink-3">{` · ${group.caption}`}</span>
                  </h3>
                  {lines.map(({ x, index }, n) => {
                    const name = `${group.title}, line ${n + 1}`;
                    const rowIssues = issuesUnder(`costs.${index}`);
                    const issueId = rowIssues.length > 0 ? `cost-${x.id}-issues` : undefined;
                    return (
                      <div key={x.id} className="mb-1.5">
                        <div className={COST_ROW}>
                          <input id={`cost-${x.id}-name`} aria-label={name} className={control} value={x.name} maxLength={80}
                            aria-invalid={issueAt(`costs.${index}.name`) ? true : undefined} aria-describedby={issueId}
                            onChange={(e) => setCost(x.id, { name: e.target.value })} />
                          <MoneyInput id={`cost-${x.id}-amount`} label={`${name} amount`} labelHidden currency={offer.currency} value={x.amount}
                            className="row-start-2 max-w-40 @min-[360px]:row-start-auto @min-[360px]:max-w-none"
                            invalid={Boolean(issueAt(`costs.${index}.amount`))} describedBy={issueId} onChange={(amount) => setCost(x.id, { amount })} />
                          {!viewer && (
                            <Button variant="ghost" size="icon"
                              className="col-start-2 row-start-1 h-9 w-7 text-ink-3 hover:bg-transparent hover:text-danger @min-[360px]:col-start-auto @min-[360px]:row-start-auto"
                              aria-label={`Remove ${x.name.trim() || `line ${n + 1}`}`} onClick={() => removeCost(x.id)}>
                              <X aria-hidden className="size-4" />
                            </Button>
                          )}
                        </div>
                        {issueId && <p id={issueId} className="mt-1 text-xs text-danger">{rowIssues.join(' ')}</p>}
                      </div>
                    );
                  })}
                  {!viewer && <Button size="sm" disabled={c.costs.length >= MAX_COSTS} onClick={() => addCost(group.when)}>Add a cost</Button>}
                </div>
              );
            })}
            </div>
            {issueAt('costs') && <p className="mt-1 text-xs text-danger">{issueAt('costs')}</p>}
            {supports && (
              <div className="mt-3.5">
                <MoneyInput id="case-support-cost" label={`Support cost per customer a year (${roles.support === 'level12' ? 'level 1 and 2' : 'level 1'})`}
                  caption="The partner’s own cost of the support it gives each customer" currency={offer.currency} className="max-w-[200px]"
                  value={c.supportCost} error={issueAt('supportCost')} onChange={(n) => set({ supportCost: n })} />
              </div>
            )}
            <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
              {`${money(costTotal('start'))} to get started, then ${money(costTotal('yearly'))} every year${preferredCost}${fee}${servicesShare}${supportCost}.`}
            </p>
          </Card>

          <Card id="benefits" title="Beyond the money" hint={`Pick up to ${MAX_BENEFITS} that matter to this partner.`}>
            <div className="flex flex-wrap gap-2">
              {BENEFITS.map((benefit) => {
                const chosen = c.benefits.includes(benefit);
                return (
                  <button key={benefit} type="button" aria-pressed={chosen} disabled={!chosen && c.benefits.length >= MAX_BENEFITS}
                    onClick={() => toggleBenefit(benefit)}
                    className={cn('rounded-full border px-3 py-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-brand',
                      // A viewer's chips are all closed: the chosen ones stay as clear as they are for everyone else.
                      !viewer && 'disabled:opacity-45',
                      chosen ? 'border-brand-strong bg-brand-strong text-on-brand' : cn('border-line bg-surface text-ink', !viewer && 'hover:bg-surface-2'))}>
                    {benefit}
                  </button>
                );
              })}
            </div>
            {issueAt('benefits') && <p className="mt-2 text-xs text-danger">{issueAt('benefits')}</p>}
          </Card>
        </div>
        </ClosedForViewer>

        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-semibold tracking-tight break-words">{`What partnering with ${offer.company} is worth to ${partner}`}</h2>
          {result && type ? (
            <>
              <p className="mt-1 mb-3.5 text-xs text-ink-3">
                {`${partnerKind(type.name)}, ${result.years.length} years, ${c.scenario} scenario. ${describeTypicalCustomer(result.typical, offer.currency)}`}
              </p>
              <ResultSummary result={result} case={forSums} />
              <div className="grid gap-3.5">
                <Card id="chart" title="Revenue per year, and profit so far">
                  <RevenueChart result={result} currency={offer.currency} interactive tiers={preferredOn} levels={levels} />
                </Card>
                <Card id="years" title="Year by year">
                  <YearTable result={result} currency={offer.currency} vendor={offer.company.trim() || 'you'} tiers={preferredOn} levels={levels} />
                </Card>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-3">This case can’t show what it is worth until its partner type is back in its offer.</p>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
