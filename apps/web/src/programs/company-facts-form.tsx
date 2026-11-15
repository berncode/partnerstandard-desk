'use client';

// Company facts, in Recruitment's look (the page heading, `Section` cards). PartnerStandard Desk keeps the company name in
// Settings, sends the facts as read (`base`) with every save, and has no Delete company (Delete account is in Settings).
import {
  customerValue, directRatio, formatMoney, formatPerOne, parseCompanyFacts, type CompanyFacts, type Currency, type Rules,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef } from 'react';
import type { RemoteResult } from '@/editor/remote';
import { Section } from '@/ui/pieces';
import { Field } from './field';
import { control, ROW2, ROW3, textarea } from './form-styles';
import { MoneyInput, OptionalMoneyInput } from './money-input';
import { Note } from './note';
import { OurFiguresCard } from './our-figures-card';
import { NumberInput } from './number-input';
import { PercentInput } from './percent-input';
import { SaveStatusLine } from './save-status';
import { useAutosave } from './use-autosave';
import { FileLinkIcon, useCopy, useFileLinkProps, useViewer } from '@/storage-context';
import { ClosedForViewer, ViewerLine } from '@/viewer-read-only';

const CURRENCIES: Currency[] = ['EUR', 'USD', 'GBP', 'CHF'];
const CONFLICT: { value: Rules['conflict']; label: string }[] = [
  { value: 'first', label: COPY.FACTS_CONFLICT_FIRST },
  { value: 'case', label: COPY.FACTS_CONFLICT_CASE },
];

/** What a save sends: the facts on screen, the facts as last read or saved, and their Updated (null before the first save). */
export interface FactsSave {
  facts: CompanyFacts;
  base: CompanyFacts;
  expectedUpdatedAt: string | null;
}

/**
 * Refusals saving again can't get past: the file changed since it was read (in the app or by hand in the sheet), the
 * sign-in or the file is gone. Saving stops and Reload brings the latest (or the page's problem screen).
 */
const STOPS = new Set(['conflict', 'auth', 'file_not_found', 'forbidden']);

/** "A typical customer brings you €79,712 over five years: €6,000 once, then €18,000 a year while they stay." */
export function typicalCustomerNote(c: CompanyFacts): string {
  const money = (n: number) => formatMoney(Number.isFinite(n) ? n : 0, c.currency);
  return COPY.FACTS_CUSTOMER_NOTE(money(customerValue(c)), money(c.once), money(c.yearly));
}

/** "Selling direct costs you €0.40 of every €1 you bring in.", or what to fill in to know it. */
export function directNote(c: CompanyFacts): string {
  const ratio = directRatio(c);
  if (ratio === null) return COPY.FACTS_DIRECT_UNKNOWN;
  return COPY.FACTS_DIRECT_NOTE(formatPerOne(ratio, c.currency), formatPerOne(1, c.currency).replace('.00', ''));
}

/**
 * Company facts (PD spec 4.1): shared by all programs of the company. Every change is checked here first and saved
 * 800 ms after the last one, with the facts as last read and their Updated, so facts changed somewhere else (another
 * screen, or a hand edit in the sheet) are never overwritten: saving stops and Reload shows the latest.
 */
export function CompanyFactsForm({ initial, companyName, fileUrl, save }: {
  initial: CompanyFacts;
  /** The company's name, from Settings. */
  companyName: string;
  /** The spreadsheet, for Open in Google Sheets; null for a test account (its files live in memory). */
  fileUrl: string | null;
  save: (input: FactsSave) => Promise<RemoteResult<CompanyFacts>>;
}) {
  const words = useCopy();
  const fileLink = useFileLinkProps();
  const router = useRouter();
  /** The facts as the file holds them: what the next save goes over. */
  const base = useRef(initial);
  // A company server's viewer reads the facts, closed, and nothing they do is saved (owner, 2026-11-14).
  const viewer = useViewer();
  const autosave = useAutosave<CompanyFacts, RemoteResult<CompanyFacts>>({
    initial,
    readOnly: viewer,
    prepare: (sent) => {
      const parsed = parseCompanyFacts(sent);
      return parsed.ok ? { ok: true, value: parsed.company } : { ok: false, message: parsed.issues[0]!.message };
    },
    save: async (facts) => {
      const result = await save({ facts, base: base.current, expectedUpdatedAt: base.current.updatedAt || null });
      if (result.ok) {
        base.current = result.snapshot.value;
        return result;
      }
      return result.error === 'conflict' ? { ...result, message: COPY.CHANGED_SOMEWHERE_ELSE } : result;
    },
    stops: (result) => !result.ok && STOPS.has(result.error),
  });
  const { value: c, status, latest, update } = autosave;
  const issues = useMemo(() => {
    const parsed = parseCompanyFacts(c);
    return parsed.ok ? [] : parsed.issues;
  }, [c]);
  const errors = useMemo(() => Object.fromEntries(issues.map((i) => [i.path, i.message])), [issues]) as Record<string, string | undefined>;
  const set = (patch: Partial<CompanyFacts>) => update({ ...latest(), ...patch });
  const setRules = (patch: Partial<Rules>) => update({ ...latest(), rules: { ...latest().rules, ...patch } });
  const { currency } = c;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold tracking-tight">{COPY.FACTS_TITLE}</h1>
          <p className="mt-1 text-sm text-ink-3">{COPY.FACTS_SUBTITLE}</p>
        </div>
        {fileUrl && (
          <a href={fileUrl} {...fileLink}
            className="inline-flex items-center gap-1 rounded text-sm font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
            {words.OPEN_IN_SHEETS}
            <FileLinkIcon />
          </a>
        )}
      </div>
      <SaveStatusLine className="mt-2 mb-2" status={status} retry={() => void autosave.flush()} reload={() => router.refresh()} />
      <ViewerLine className="mb-4" />
      <ClosedForViewer>
      <div className="grid gap-4">
        <Section title={COPY.FACTS_COMPANY} description={COPY.FACTS_COMPANY_HINT}>
          <div className={ROW2}>
            <div className="grid content-start gap-1">
              <p className="text-xs font-medium text-ink-3">{COPY.FACTS_NAME}</p>
              <p className="flex min-h-9 items-center text-sm break-words text-ink">{companyName.trim() || COPY.COMPANY_UNNAMED}</p>
              <Link href="/settings" className="w-fit rounded text-xs text-ink-3 underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand">
                {COPY.FACTS_NAME_IN_SETTINGS}
              </Link>
            </div>
            <Field label={COPY.FACTS_CURRENCY}>
              {(describedBy) => (
                <select className={control} value={c.currency} aria-describedby={describedBy} onChange={(e) => set({ currency: e.target.value as Currency })}>
                  {CURRENCIES.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              )}
            </Field>
          </div>
        </Section>

        <Section title={COPY.FACTS_CUSTOMER} description={COPY.FACTS_CUSTOMER_HINT}>
          <div className={ROW3}>
            <MoneyInput id="cf-yearly" label={COPY.FACTS_YEARLY} currency={currency} value={c.yearly} error={errors.yearly} onChange={(yearly) => set({ yearly })} />
            <MoneyInput id="cf-once" label={COPY.FACTS_ONCE} caption={COPY.FACTS_ONCE_CAPTION} currency={currency} value={c.once} error={errors.once}
              onChange={(once) => set({ once })} />
            <PercentInput id="cf-renew" label={COPY.FACTS_RENEW} unit={COPY.FACTS_RENEW_UNIT} value={c.renew} error={errors.renew} onChange={(renew) => set({ renew })} />
          </div>
          <Note>{typicalCustomerNote(c)}</Note>
        </Section>

        <Section title={COPY.FACTS_DIRECT} description={COPY.FACTS_DIRECT_HINT}>
          <div className={ROW2}>
            <OptionalMoneyInput id="cf-spend" label={COPY.FACTS_SPEND} caption={COPY.FACTS_SPEND_CAPTION} currency={currency}
              value={c.spend} error={errors.spend} onChange={(spend) => set({ spend })} />
            <OptionalMoneyInput id="cf-revenue" label={COPY.FACTS_REVENUE} currency={currency} value={c.revenue} error={errors.revenue}
              onChange={(revenue) => set({ revenue })} />
          </div>
          <Note>{directNote(c)}</Note>
        </Section>

        <Section title={COPY.FACTS_DEALS} description={COPY.FACTS_DEALS_HINT}>
          <div className="grid gap-3">
            <div className={ROW3}>
              <NumberInput id="cf-protect" label={COPY.FACTS_PROTECT} unit={COPY.UNIT_DAYS} value={c.rules.protect} error={errors['rules.protect']}
                onChange={(protect) => setRules({ protect })} />
              <NumberInput id="cf-extend" label={COPY.FACTS_EXTEND} unit={COPY.UNIT_DAYS} caption={COPY.FACTS_EXTEND_CAPTION} value={c.rules.extend}
                error={errors['rules.extend']} onChange={(extend) => setRules({ extend })} />
              <NumberInput id="cf-answer" label={COPY.FACTS_ANSWER} unit={COPY.UNIT_HOURS} value={c.rules.answer} error={errors['rules.answer']}
                onChange={(answer) => setRules({ answer })} />
            </div>
            <div className={ROW2}>
              <Field label={COPY.FACTS_CONFLICT}>
                {(describedBy) => (
                  <select className={control} value={c.rules.conflict} aria-describedby={describedBy}
                    onChange={(e) => setRules({ conflict: e.target.value as Rules['conflict'] })}>
                    {CONFLICT.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                  </select>
                )}
              </Field>
              <div className="grid content-start gap-1">
                {/* Takes the place of a label, so the box lines up with the select beside it. */}
                <span aria-hidden className="hidden text-xs min-[561px]:block">&nbsp;</span>
                <label className="flex min-h-9 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand-strong" checked={c.rules.paidInFull}
                    onChange={(e) => setRules({ paidInFull: e.target.checked })} />
                  {COPY.FACTS_PAID_IN_FULL}
                </label>
              </div>
            </div>
          </div>
          <Note>{COPY.FACTS_TURN_DOWN}</Note>
        </Section>

        <Section title={COPY.FACTS_HANDOVER_CARD} description={COPY.FACTS_HANDOVER_CARD_HINT}>
          <div className="grid gap-3">
            <Field label={COPY.FACTS_OWNER} error={errors['rules.ownerNote']} hint={COPY.FACTS_OWNER_HINT}>
              {(describedBy) => (
                <textarea className={textarea} value={c.rules.ownerNote} aria-describedby={describedBy} aria-invalid={errors['rules.ownerNote'] ? true : undefined}
                  placeholder={COPY.FACTS_OWNER_PLACEHOLDER} onChange={(e) => setRules({ ownerNote: e.target.value })} />
              )}
            </Field>
            <Field label={COPY.FACTS_HANDOVER} error={errors['rules.handover']}>
              {(describedBy) => (
                <textarea className={textarea} value={c.rules.handover} aria-describedby={describedBy} aria-invalid={errors['rules.handover'] ? true : undefined}
                  onChange={(e) => setRules({ handover: e.target.value })} />
              )}
            </Field>
          </div>
        </Section>

        <OurFiguresCard ours={c.ours} currency={currency} issues={issues} onChange={(ours) => update({ ...latest(), ours })} />
      </div>
      </ClosedForViewer>
    </div>
  );
}
