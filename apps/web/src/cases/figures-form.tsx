'use client';

import type { CaseIssue as Issue, CaseSource as Source, Currency, Figures, Serve } from '@partner-desk/core';
import { issueAt } from './issues';
import { MoneyInput } from '@/programs/money-input';
import { PercentInput } from '@/programs/percent-input';
import { SourceSelect } from './source-select';

type Amount = 'find' | 'close' | 'support1' | 'support2' | 'servicesCost' | 'servicesCharge';
type ServeSource = 'salesSource' | 'supportSource' | 'servicesSource';

/** Two by two, as in the prototype: one source per pair, under its second field. */
const PAIRS: { fields: [Amount, string, string][]; source: ServeSource; sourceLabel: string }[] = [
  {
    fields: [['find', 'Finding a lead', 'Per deal: marketing and lead generation'], ['close', 'Closing a deal', 'Per deal: sales and presales time']],
    source: 'salesSource', sourceLabel: 'Sales costs source',
  },
  {
    fields: [['support1', 'Support level 1', 'Per customer a year'], ['support2', 'Support level 2', 'Per customer a year']],
    source: 'supportSource', sourceLabel: 'Support costs source',
  },
  {
    fields: [['servicesCost', 'Services: your cost', 'Per new customer'], ['servicesCharge', 'Services: what you charge', 'Per new customer']],
    source: 'servicesSource', sourceLabel: 'Services source',
  },
];

/** Two fields side by side where both labels fit on one line; on a phone they stack. */
const PAIR = 'grid grid-cols-1 items-start gap-3 @min-[340px]:grid-cols-2';

/** Your gross margin and where it comes from (one field, for a pair). `issues` are relative to the figures. */
export function GrossMarginField({ figures, onChange, issues }: {
  figures: Figures; onChange: (f: Figures) => void; issues: Issue[];
}) {
  return (
    <div className="min-w-0">
      <PercentInput id="figures-margin" label="Your gross margin" caption="Left after hosting and delivery, before support"
        value={figures.margin} error={issueAt(issues, 'margin')} onChange={(margin) => onChange({ ...figures, margin })} />
      <SourceSelect id="figures-margin-source" label="Your gross margin source" value={figures.marginSource}
        onChange={(marginSource: Source) => onChange({ ...figures, marginSource })} />
    </div>
  );
}

/**
 * What winning and serving a customer costs you without a partner (spec §7.1 item 2), two by two, one source per pair.
 * `issues` are relative to the figures (`serve.find`).
 */
export function ServeFields({ figures, onChange, issues, currency }: {
  figures: Figures; onChange: (f: Figures) => void; issues: Issue[]; currency: Currency;
}) {
  const setServe = (patch: Partial<Serve>) => onChange({ ...figures, serve: { ...figures.serve, ...patch } });
  return (
    <div className="@container grid min-w-0 gap-3">
      {PAIRS.map(({ fields, source, sourceLabel }) => (
        <div key={source} className={PAIR}>
          {fields.map(([key, label, caption], i) => (
            <div key={key} className="min-w-0">
              <MoneyInput id={`figures-${key}`} label={label} caption={caption} currency={currency} value={figures.serve[key]}
                error={issueAt(issues, `serve.${key}`)} onChange={(n) => setServe({ [key]: n })} />
              {i === 1 && (
                <SourceSelect id={`figures-${source}`} label={sourceLabel} value={figures.serve[source]}
                  onChange={(s) => setServe({ [source]: s })} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Facts about the vendor that a case of ours uses (spec §7.1, items 1 and 2): our gross margin, and what winning and
 * serving a customer costs us without a partner, each with where it comes from. `issues` are relative to the figures
 * (`serve.find`).
 */
export function FiguresForm({ figures, onChange, issues, currency }: {
  figures: Figures; onChange: (f: Figures) => void; issues: Issue[]; currency: Currency;
}) {
  return (
    <div className="@container grid min-w-0 gap-4">
      <div className={PAIR}>
        <GrossMarginField figures={figures} onChange={onChange} issues={issues} />
      </div>
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold">Winning and serving a customer yourself</h3>
        <p className="mt-0.5 mb-3 text-xs text-ink-3">What a customer costs you without a partner. The partner type decides which parts the partner takes over.</p>
        <ServeFields figures={figures} onChange={onChange} issues={issues} currency={currency} />
      </div>
    </div>
  );
}
