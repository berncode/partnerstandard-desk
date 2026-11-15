'use client';

import { EXAMPLE_MARKET, PARTNER_TYPE_LABELS, TIPS } from '@partner-desk/method';
import { COPY, HOW_MARKET_BUYS_LABELS } from '@partner-desk/copy';
import type { HowMarketBuys } from '@partner-desk/core';
import { HOW_MARKET_BUYS } from '@partner-desk/core';
import type { RecruitmentPartnerType } from '@partner-desk/method';
import { BookOpen, Sparkles, X } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { CopyButton } from '@/ui/copy-button';
import { Field, fieldControl, PartnerTypeSelect, partnerTypeHint } from './fields';
import type { FirstPartner } from './markets-model';

/** The four steps, each with a tip. Only the first can't be skipped. */
export const STEPS = [
  { key: 'market', name: COPY.STEP_MARKET, title: COPY.TITLE_MARKET, tip: TIPS['newMarket.market'] },
  { key: 'why', name: COPY.STEP_WHY, title: COPY.TITLE_WHY, tip: TIPS['newMarket.why'] },
  { key: 'mustHaves', name: COPY.STEP_MUST_HAVES, title: COPY.TITLE_MUST_HAVES, tip: TIPS['newMarket.mustHaves'] },
  { key: 'partners', name: COPY.STEP_FIRST_PARTNERS, title: COPY.TITLE_FIRST_PARTNERS, tip: TIPS['newMarket.firstCandidates'] },
] as const;

/** The market fields the flow asks for. */
export interface MarketDraft {
  marketName: string;
  partnerType: RecruitmentPartnerType;
  ourProduct: string;
  ourTargetCustomers: string;
  whyPartnerRoute: string;
  mustHaves: string[];
  howMarketBuys: HowMarketBuys;
  howMarketBuysNote: string;
}

type StepProps = { draft: MarketDraft; errors: Record<string, string>; onChange: (patch: Partial<MarketDraft>) => void };

/** A filled-in example from the sample market, next to the empty field. */
function Example({ fields }: { fields: Array<[label: string, value: string]> }) {
  return (
    <aside aria-label={COPY.EXAMPLE} className="min-w-0 rounded-xl border border-dashed border-line p-4 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-ink-3 uppercase">
        <BookOpen className="h-3.5 w-3.5" aria-hidden />
        {COPY.EXAMPLE}
      </p>
      <dl className="mt-2 space-y-3">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-ink-3">{label}</dt>
            <dd className="mt-0.5 break-words whitespace-pre-line text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function WithExample({ example, children }: { example: Array<[string, string]>; children: ReactNode }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid min-w-0 content-start gap-4">{children}</div>
      <Example fields={example} />
    </div>
  );
}

const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

// 1. Market

export function MarketStep({ draft, errors, onChange }: StepProps) {
  return (
    <WithExample example={[
      [COPY.FIELD_MARKET_NAME, EXAMPLE_MARKET.marketName], [COPY.COLUMN_PARTNER_TYPE, PARTNER_TYPE_LABELS[EXAMPLE_MARKET.partnerType]],
      [COPY.FIELD_OUR_PRODUCT, EXAMPLE_MARKET.ourProduct], [COPY.FIELD_TARGET_CUSTOMERS, EXAMPLE_MARKET.ourTargetCustomers],
    ]}>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label={COPY.FIELD_MARKET_NAME} error={errors.marketName} hint={COPY.HINT_MARKET_NAME}>
          {(describedBy) => (
            <input autoFocus className={cn(fieldControl, 'h-9 py-0')} value={draft.marketName} placeholder={COPY.PLACEHOLDER_MARKET_NAME}
              aria-describedby={describedBy} aria-invalid={errors.marketName ? true : undefined}
              onChange={(e) => onChange({ marketName: e.target.value })} />
          )}
        </Field>
        <Field label={COPY.COLUMN_PARTNER_TYPE} error={errors.partnerType} hint={partnerTypeHint(draft.partnerType)}>
          {(describedBy) => <PartnerTypeSelect value={draft.partnerType} describedBy={describedBy} onChange={(partnerType) => onChange({ partnerType })} />}
        </Field>
      </div>
      <Field label={COPY.FIELD_OUR_PRODUCT} error={errors.ourProduct} hint={COPY.HINT_OUR_PRODUCT}>
        {(describedBy) => (
          <textarea rows={2} className={fieldControl} value={draft.ourProduct} aria-describedby={describedBy}
            aria-invalid={errors.ourProduct ? true : undefined} onChange={(e) => onChange({ ourProduct: e.target.value })} />
        )}
      </Field>
      <Field label={COPY.FIELD_TARGET_CUSTOMERS} error={errors.ourTargetCustomers} hint={COPY.HINT_TARGET_CUSTOMERS}>
        {(describedBy) => (
          <textarea rows={2} className={fieldControl} value={draft.ourTargetCustomers} aria-describedby={describedBy}
            aria-invalid={errors.ourTargetCustomers ? true : undefined} onChange={(e) => onChange({ ourTargetCustomers: e.target.value })} />
        )}
      </Field>
    </WithExample>
  );
}

// 2. Why partners

export function WhyStep({ draft, errors, onChange }: StepProps) {
  return (
    <WithExample example={[[COPY.FIELD_WHY_ROUTE, EXAMPLE_MARKET.whyPartnerRoute]]}>
      <Field label={COPY.FIELD_WHY_ROUTE} error={errors.whyPartnerRoute} hint={COPY.HINT_WHY_ROUTE}>
        {(describedBy) => (
          <textarea autoFocus rows={5} className={fieldControl} value={draft.whyPartnerRoute} aria-describedby={describedBy}
            aria-invalid={errors.whyPartnerRoute ? true : undefined} onChange={(e) => onChange({ whyPartnerRoute: e.target.value })} />
        )}
      </Field>
    </WithExample>
  );
}

// 3. Must-haves and how the market buys

export function MustHavesStep({ draft, errors, onChange }: StepProps) {
  // The text as typed, so blank lines survive while typing; the draft keeps the list.
  const [text, setText] = useState(() => draft.mustHaves.join('\n'));
  const groupId = useId();
  return (
    <WithExample example={[[COPY.FIELD_MUST_HAVES, EXAMPLE_MARKET.mustHaves.join('\n')], [COPY.HOW_MARKET_BUYS, EXAMPLE_MARKET.howMarketBuys]]}>
      <Field label={COPY.FIELD_MUST_HAVES} error={errors.mustHaves} hint={COPY.HINT_MUST_HAVES}>
        {(describedBy) => (
          <textarea autoFocus rows={5} className={fieldControl} value={text} aria-describedby={describedBy}
            aria-invalid={errors.mustHaves ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              onChange({ mustHaves: lines(e.target.value) });
            }} />
        )}
      </Field>
      <fieldset className="m-0 min-w-0 border-0 p-0" aria-describedby={groupId}>
        <legend className="text-xs font-medium text-ink-3">{COPY.HOW_MARKET_BUYS}</legend>
        <p id={groupId} className="mt-1 text-xs text-ink-3">{COPY.HOW_MARKET_BUYS_QUESTION}</p>
        <div className="mt-2 grid gap-2">
          {HOW_MARKET_BUYS.map((value) => (
            <label key={value} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm',
              draft.howMarketBuys === value ? 'border-brand bg-brand-soft/40' : 'border-line')}>
              <input type="radio" name="howMarketBuys" className="mt-0.5 accent-[var(--brand-strong)]" checked={draft.howMarketBuys === value}
                onChange={() => onChange({ howMarketBuys: value })} />
              <span>
                <span className="font-medium">{HOW_MARKET_BUYS_LABELS[value]}</span>
                <span className="block text-xs text-ink-3">{COPY.HOW_BUYS_HELP[value]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={COPY.HOW_MARKET_BUYS_NOTE} error={errors.howMarketBuysNote}>
        {(describedBy) => (
          <textarea rows={2} className={fieldControl} value={draft.howMarketBuysNote} aria-describedby={describedBy}
            onChange={(e) => onChange({ howMarketBuysNote: e.target.value })} />
        )}
      </Field>
    </WithExample>
  );
}

// 4. First partners

export function FirstPartnersStep({ partners, noteFor, onAdd, onRemove, searchPrompt }: {
  partners: FirstPartner[];
  /** The import's note for this company, or null when it is new. */
  noteFor: (partner: FirstPartner) => string | null;
  /** Adds the partner to the list; a refusal comes back as the text to show under the company. */
  onAdd: (company: string, website: string) => string | null;
  onRemove: (id: string) => void;
  searchPrompt: string;
}) {
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copyBlocked, setCopyBlocked] = useState(false);
  const promptBox = useRef<HTMLTextAreaElement>(null);
  const add = () => {
    if (!company.trim() && !website.trim()) return;
    const refusal = onAdd(company.trim(), website.trim());
    if (refusal) {
      setError(refusal);
      return;
    }
    setCompany('');
    setWebsite('');
    setError(null);
  };
  return (
    <WithExample example={[[COPY.FIRST_PARTNERS, EXAMPLE_MARKET.firstPartners.join('\n')]]}>
      {partners.length > 0 && (
        <ul aria-label={COPY.FIRST_PARTNERS} className="space-y-1.5">
          {partners.map((p) => {
            const note = noteFor(p);
            return (
            <li key={p.id} className="flex items-start gap-2 rounded-lg bg-surface-2/70 px-3 py-2 text-sm">
              <p className="min-w-0 flex-1 break-words">
                <span className="font-medium">{p.company}</span>
                {p.website && <span className="text-ink-3"> · {p.website}</span>}
                {note && <span className="mt-0.5 block text-xs text-warn">{note}</span>}
              </p>
              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={COPY.REMOVE_NAMED(p.company)} onClick={() => onRemove(p.id)}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
            );
          })}
        </ul>
      )}
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Field label={COPY.FIELD_COMPANY} error={error ?? undefined}>
          {(describedBy) => (
            <input autoFocus className={cn(fieldControl, 'h-9 py-0')} value={company} placeholder={COPY.FIELD_COMPANY_PLACEHOLDER}
              aria-describedby={describedBy} aria-invalid={error ? true : undefined} onChange={(e) => setCompany(e.target.value)} />
          )}
        </Field>
        <Field label={COPY.FIELD_WEBSITE}>
          {(describedBy) => (
            <input className={cn(fieldControl, 'h-9 py-0')} value={website} placeholder={COPY.PLACEHOLDER_WEBSITE}
              aria-describedby={describedBy} onChange={(e) => setWebsite(e.target.value)} />
          )}
        </Field>
        <Button type="submit" className="sm:mt-5">{COPY.ADD}</Button>
      </form>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
        <Sparkles className="h-4 w-4 shrink-0 text-brand-strong" aria-hidden />
        <p className="min-w-0 flex-1 basis-60 text-ink-2">{COPY.SEARCH_WITH_AI_TEXT}</p>
        <CopyButton text={searchPrompt} onCopyFailed={() => setCopyBlocked(true)}>{COPY.SEARCH_WITH_AI}</CopyButton>
      </div>
      {copyBlocked && (
        <div className="grid gap-2">
          <p className="text-sm text-ink-2">{COPY.COPY_BLOCKED}</p>
          <textarea ref={promptBox} readOnly rows={8} aria-label={COPY.SEARCH_PROMPT} value={searchPrompt}
            className="w-full min-w-0 rounded-lg border border-line bg-surface-2/60 px-2.5 py-2 font-mono text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
          <div>
            <Button size="sm" onClick={() => { promptBox.current?.focus(); promptBox.current?.select(); }}>{COPY.SELECT_ALL}</Button>
          </div>
        </div>
      )}
    </WithExample>
  );
}
