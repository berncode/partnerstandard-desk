'use client';

// The step's cards use Recruitment's `Section`; the words come from COPY.

import { useId } from 'react';
import { KIND, MODELS, WHO_INVOICES, type Base, type Model, type Money, type Pattern, type Payout, type Running } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Section } from '@/ui/pieces';
import { Field } from '../field';
import { control, ROW2, textarea } from '../form-styles';
import { MoneyInput } from '../money-input';
import { Note } from '../note';
import { NumberInput } from '../number-input';
import { RatesTable } from '../rates-table';
import type { StepProps } from './step-props';

const PATTERNS: [Pattern, string][] = [['oneoff', COPY.PROG_PATTERN_ONEOFF], ['lifetime', COPY.PROG_PATTERN_LIFETIME]];
const BASES: [Base, string][] = [['year', COPY.PROG_BASE_YEAR], ['contract', COPY.PROG_BASE_CONTRACT]];
const PAYOUTS: [Payout, string][] = [
  ['customer', COPY.PROG_PAYOUT_CUSTOMER], ['month', COPY.PROG_PAYOUT_MONTH], ['quarter', COPY.PROG_PAYOUT_QUARTER],
];

/**
 * Step 5, Money (PD spec §4.7): how partners are paid (who invoices, the pay model, the rates per level), when they are
 * paid, and what the program costs to run. Changing the pay model keeps every other money answer. At a glance sits
 * beside it (ProgramStep).
 */
export function MoneyStep(props: StepProps) {
  const { company, program: p, errors, onChange } = props;
  const ids = useId();
  const m = p.money;
  const kind = KIND[p.type];
  const setMoney = (patch: Partial<Money>) => onChange({ ...p, money: { ...m, ...patch } });
  const setRun = (patch: Partial<Running>) => onChange({ ...p, run: { ...p.run, ...patch } });

  const select = <T extends string>(label: string, value: T, choices: [T, string][], set: (v: T) => void, error?: string) => (
    <Field label={label} error={error}>
      {(describedBy) => (
        <select className={control} value={value} aria-describedby={describedBy} aria-invalid={error ? true : undefined}
          onChange={(e) => set(e.target.value as T)}>
          {choices.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
      )}
    </Field>
  );
  const yearly = (key: Exclude<keyof Running, 'deals'>, label: string) => (
    <MoneyInput id={`${ids}-${key}`} label={label} currency={company.currency} unit={COPY.PROG_A_YEAR} value={p.run[key]} error={errors[`run.${key}`]}
      onChange={(n) => setRun({ [key]: n })} />
  );

  return (
    <div className="grid gap-4">
      <Section title={COPY.PROG_PAID_HOW} description={WHO_INVOICES[kind]}>
        <div className="grid gap-3">
          <div className={ROW2}>
            {select<Model>(COPY.PROG_PAID_AS, m.model, MODELS[kind], (model) => setMoney({ model }), errors['money.model'])}
            {m.model === 'commission' && select(COPY.PROG_COMMISSION, m.pattern, PATTERNS, (pattern) => setMoney({ pattern }), errors['money.pattern'])}
          </div>
          {m.model === 'commission' && m.pattern === 'oneoff' && (
            <div className={ROW2}>
              {select(COPY.PROG_PAID_ON, m.base, BASES, (base) => setMoney({ base }), errors['money.base'])}
              {m.base === 'contract' && (
                <NumberInput id={`${ids}-years`} label={COPY.PROG_CONTRACT_RUNS} unit={COPY.UNIT_YEARS} value={m.years} error={errors['money.years']}
                  onChange={(years) => setMoney({ years })} />
              )}
            </div>
          )}
          {m.model === 'none' ? (
            <Field label={COPY.PROG_REWARDS} error={errors['money.rewards']}>
              {(describedBy) => (
                <textarea className={textarea} value={m.rewards} maxLength={2000} aria-describedby={describedBy}
                  aria-invalid={errors['money.rewards'] ? true : undefined} onChange={(e) => setMoney({ rewards: e.target.value })} />
              )}
            </Field>
          ) : <RatesTable {...props} />}
        </div>
        {m.model === 'margin' && (
          <Note>{COPY.PROG_MARGIN_NOTE}</Note>
        )}
      </Section>

      {m.model !== 'none' && (
        <Section title={COPY.PROG_PAID_WHEN} description={COPY.PROG_PAID_WHEN_HINT}>
          <div className={ROW2}>
            {select(COPY.PROG_PAID, m.payout, PAYOUTS, (payout) => setMoney({ payout }), errors['money.payout'])}
            <NumberInput id={`${ids}-days`} label={COPY.PROG_WITHIN} unit={COPY.UNIT_DAYS} value={m.payDays} error={errors['money.payDays']}
              onChange={(payDays) => setMoney({ payDays })} />
          </div>
        </Section>
      )}

      <Section title={COPY.PROG_RUN_COSTS} description={COPY.PROG_RUN_COSTS_HINT}>
        <div className="grid gap-3">
          <div className={ROW2}>
            {yearly('manager', COPY.PROG_RUN_MANAGER)}
            {yearly('funds', COPY.PROG_RUN_FUNDS)}
          </div>
          <div className={ROW2}>
            {yearly('training', COPY.PROG_RUN_TRAINING)}
            <NumberInput id={`${ids}-deals`} label={COPY.PROG_RUN_DEALS} unit={COPY.PROG_A_YEAR} value={p.run.deals} error={errors['run.deals']}
              onChange={(deals) => setRun({ deals })} />
          </div>
        </div>
      </Section>
    </div>
  );
}
