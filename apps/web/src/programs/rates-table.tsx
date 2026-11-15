'use client';

// The words come from COPY.

import { Fragment } from 'react';
import { levelNames, rateLabel, type Level, type Program, type Rates } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { MoneyInput } from './money-input';
import { PercentInput } from './percent-input';
import type { StepProps } from './steps/step-props';

/** A rate row: its label and, per level, the index in the level's rates (first sale, renewal, once). */
type Row = { label: string; index: 0 | 1 | 2 };

/**
 * The rows the program's pay model asks for (PD spec §4.7). Commission's once row only when a typical customer pays
 * something once. Empty for a flat fee (one money row) and for no payment (no table).
 */
export function rateRows(p: Program, once: number): Row[] {
  const m = p.money;
  const row = (index: Row['index']): Row => ({ label: rateLabel(m, index), index });
  if (m.model === 'margin') return [row(0)];
  if (m.model !== 'commission') return [];
  const onceRow: Row[] = once > 0 ? [row(2)] : [];
  if (m.pattern === 'oneoff') return [row(0), ...onceRow];
  return [row(0), row(1), ...onceRow];
}

const levelColumn = 'w-[102px] min-[561px]:w-[130px]';

/**
 * How much each level is paid, a column per level headed with the level names (Preferred only when the program has
 * it): percentages for margin and commission, money for a flat fee. Nothing for no payment.
 */
export function RatesTable({ company, program: p, errors, onChange }: StepProps) {
  const m = p.money;
  if (m.model === 'none') return null;
  const tiers: Level[] = p.prefOn ? ['reg', 'pref'] : ['reg'];
  const names = levelNames(p);
  const name = (t: Level) => names[t];
  const setRate = (t: Level, index: number, n: number) =>
    onChange({ ...p, money: { ...m, rates: { ...m.rates, [t]: m.rates[t].map((v, i) => (i === index ? n : v)) as Rates } } });
  const setFee = (t: Level, n: number) => onChange({ ...p, money: { ...m, fee: { ...m.fee, [t]: n } } });

  // A flat fee is one money row (no index into the rates).
  const rows: { label: string; index: Row['index'] | null; paths: string[] }[] = m.model === 'fee'
    ? [{ label: COPY.PROG_PER_NEW_CUSTOMER, index: null, paths: tiers.map((t) => `money.fee.${t}`) }]
    : rateRows(p, Number(company.once) || 0).map((r) => ({ ...r, paths: tiers.map((t) => `money.rates.${t}.${r.index}`) }));

  return (
    <table aria-label={COPY.PROG_RATES_LABEL} className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col />
        {tiers.map((t) => <col key={t} className={levelColumn} />)}
      </colgroup>
      <thead>
        <tr>
          <td />
          {tiers.map((t) => (
            <th key={t} scope="col" className="pb-1 pl-2.5 pr-[9px] break-words align-bottom text-right text-xs font-normal text-ink-3">{name(t)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => {
          const wrong = row.paths.map((path) => errors[path]);
          const message = wrong.find(Boolean);
          const errorId = `rate-error-${r}`;
          return (
            <Fragment key={row.label}>
              <tr>
                <th scope="row" className="py-1 text-left font-normal break-words text-ink">{row.label}</th>
                {tiers.map((t, i) => {
                  const { index } = row;
                  const common = {
                    id: `rate-${t}-${r}`, label: `${name(t)}: ${row.label}`, labelHidden: true, invalid: Boolean(wrong[i]),
                    describedBy: message ? errorId : undefined,
                  };
                  return (
                    <td key={t} className="py-1 pl-2.5">
                      {index === null
                        ? <MoneyInput {...common} currency={company.currency} value={m.fee[t]} onChange={(n) => setFee(t, n)} />
                        : <PercentInput {...common} value={m.rates[t][index]} onChange={(n) => setRate(t, index, n)} />}
                    </td>
                  );
                })}
              </tr>
              {message && (
                <tr>
                  <td colSpan={tiers.length + 1} id={errorId} className="pb-1 text-xs text-danger">{message}</td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
