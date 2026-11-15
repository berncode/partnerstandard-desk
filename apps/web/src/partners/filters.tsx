'use client';

// The view tabs follow the Recruitment app's tabs.
import {
  PARTNER_CATEGORIES,
  PARTNER_CATEGORY_INFO,
  PARTNER_TYPE_LABELS,
  partnerTypesIn,
  VIEWS,
  VIEW_LABELS,
  type PartnerType,
  type View,
} from '@partner-desk/method';
import {
  COPY,
} from '@partner-desk/copy';
import { Tabs } from 'radix-ui';
import { mapHealthLabel } from '@/maps/badges';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import type { ProgramOption } from '@/programs/title';
import {
  HEALTH_CHOICES, hasBoard, NO_PROGRAM, STAGE_CHOICES, type HealthChoice, type Layout, type MarketOption, type PartnerQuery,
} from './partners-model';

/** Every partner type, grouped by its category, as the options of a select. */
export function PartnerTypeOptions() {
  return (
    <>
      {PARTNER_CATEGORIES.map((category) => (
        <optgroup key={category} label={PARTNER_CATEGORY_INFO[category].shortName}>
          {partnerTypesIn(category).map((type) => <option key={type} value={type}>{PARTNER_TYPE_LABELS[type]}</option>)}
        </optgroup>
      ))}
      <option value="other">{PARTNER_TYPE_LABELS.other}</option>
    </>
  );
}

/** Potential, Active and Closed, each with how many partners it holds. The panel is the list under them. */
export function ViewTabs({ view, counts, onChange, children }: {
  view: View; counts: Record<View, number>; onChange: (view: View) => void; children: React.ReactNode;
}) {
  return (
    <Tabs.Root value={view} onValueChange={(value) => onChange(value as View)}>
      <Tabs.List aria-label={COPY.PARTNER_VIEWS} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-surface-2 p-0.5">
        {VIEWS.map((v) => (
          <Tabs.Trigger
            key={v}
            value={v}
            className="inline-flex shrink-0 items-baseline gap-1.5 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            {VIEW_LABELS[v]}{' '}
            <span className="text-xs font-normal text-ink-3">{counts[v]}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value={view} className="pt-4 outline-none">{children}</Tabs.Content>
    </Tabs.Root>
  );
}

/**
 * Partner type, market, program (once the company has one), stage (the stage choices are the view's own) and MAP
 * health (once a partner type has a MAP, with the order by it), and the list and board switch.
 */
export function FilterBar({ query, markets, programs = [], programsListed = true, mapHealth = false, onChange }: {
  query: PartnerQuery; markets: readonly MarketOption[]; programs?: readonly ProgramOption[];
  /** False when the list of programs couldn't be read: an id in the address is then unknown, not deleted. */
  programsListed?: boolean;
  /** Shows the MAP health filter and the order by it (spec 5.7). */
  mapHealth?: boolean;
  onChange: (patch: Partial<PartnerQuery>) => void;
}) {
  const known = markets.some((m) => m.marketId === query.market);
  const knownProgram = query.program === NO_PROGRAM || programs.some((p) => p.programId === query.program);
  return (
    <div role="group" aria-label={COPY.PARTNER_FILTERS} className="mb-4 flex flex-wrap items-center gap-2">
      <select aria-label={COPY.FILTER_PARTNER_TYPE} value={query.type ?? ''} className={cn(controlClass, 'w-auto max-w-full')}
        onChange={(e) => onChange({ type: (e.target.value || null) as PartnerType | null })}>
        <option value="">{COPY.ALL_PARTNER_TYPES}</option>
        <PartnerTypeOptions />
      </select>
      <select aria-label={COPY.FILTER_MARKET} value={query.market ?? ''} className={cn(controlClass, 'w-auto max-w-full')}
        onChange={(e) => onChange({ market: e.target.value || null })}>
        <option value="">{COPY.ALL_MARKETS}</option>
        {markets.map((m) => <option key={m.marketId} value={m.marketId}>{m.displayName}</option>)}
        {query.market && !known && <option value={query.market}>{query.market}</option>}
      </select>
      {(programs.length > 0 || query.program !== null) && (
        <select aria-label={COPY.FILTER_PROGRAM} value={query.program ?? ''} className={cn(controlClass, 'w-auto max-w-full')}
          onChange={(e) => onChange({ program: e.target.value || null })}>
          <option value="">{COPY.ALL_PROGRAMS}</option>
          {programs.map((p) => <option key={p.programId} value={p.programId}>{p.title}</option>)}
          <option value={NO_PROGRAM}>{COPY.NO_PROGRAM}</option>
          {query.program && !knownProgram && <option value={query.program}>{programsListed ? COPY.PROGRAM_GONE : query.program}</option>}
        </select>
      )}
      <select aria-label={COPY.FILTER_STAGE} value={query.stage ?? ''} className={cn(controlClass, 'w-auto max-w-full')}
        onChange={(e) => onChange({ stage: e.target.value || null })}>
        <option value="">{COPY.ALL_STAGES}</option>
        {STAGE_CHOICES[query.view].map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {mapHealth && (
        <>
          <select aria-label={COPY.FILTER_MAP_HEALTH} value={query.health ?? ''} className={cn(controlClass, 'w-auto max-w-full')}
            onChange={(e) => onChange({ health: (e.target.value || null) as HealthChoice | null })}>
            <option value="">{COPY.ALL_MAP_HEALTH}</option>
            {HEALTH_CHOICES.map((h) => <option key={h} value={h}>{h === 'none' ? COPY.NO_MAP : mapHealthLabel(h)}</option>)}
          </select>
          {query.layout === 'list' && (
            <button type="button" aria-pressed={query.sort === 'health'} onClick={() => onChange({ sort: query.sort === 'health' ? 'recent' : 'health' })}
              className="h-8 rounded-lg border border-line px-3 text-sm font-medium text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-strong">
              {COPY.SORT_BY_MAP_HEALTH}
            </button>
          )}
        </>
      )}
      {hasBoard(query.view) && <LayoutSwitch layout={query.layout} onChange={(layout) => onChange({ layout })} />}
    </div>
  );
}

function LayoutSwitch({ layout, onChange }: { layout: Layout; onChange: (layout: Layout) => void }) {
  return (
    <div role="group" aria-label={COPY.LAYOUT_LABEL} className="ml-auto inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
      {([['list', COPY.LAYOUT_LIST], ['board', COPY.LAYOUT_BOARD]] as const).map(([value, label]) => (
        <button key={value} type="button" aria-pressed={layout === value} onClick={() => onChange(value)}
          className="rounded-md px-3 py-1 text-sm font-medium text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm">
          {label}
        </button>
      ))}
    </div>
  );
}
