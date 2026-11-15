'use client';

// The review's scorecard (reviews spec 5.4): each number with its actual, its target and how far it got, in a percent.
// Typed by hand, each with a source and a note. No traffic lights: the MAP's health is the only one (builder's call).
import { CASE_SOURCES, type CaseSource, type Currency, type MapApplyOutcome, type MapHealth, type ScoreKey } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useState } from 'react';
import { cn } from '@/ui/cn';
import { HealthBadge } from '@/maps/badges';
import { InlineText } from '@/maps/components/inline-text';
import { fieldControl, PillSelect } from '@/maps/pieces';
import { CURRENCY_SIGN } from '@/cases/format';
import { fieldAmount, formatScore, isMoney, parseAmount, scorePercent } from './review-model';

export interface ScoreRow {
  key: ScoreKey;
  label: string;
  actual: number | null;
  /** The stored target, else the one the review computes (the last review's next target, or the business case's). */
  target: number | null;
  source: CaseSource | null;
  note: string;
  /** What the actual could be, from the MAP, the account or the case: offered with one click while the actual is empty. */
  suggestion: number | null;
}

export type ScorePatch = Partial<Pick<ScoreRow, 'actual' | 'target' | 'source' | 'note'>>;

export function ScorecardTable({ rows, noCase, map, currency = null, readOnly = false, onChange }: {
  rows: ScoreRow[];
  /** The business case's currency, for the money: none without a case. */
  currency?: Currency | null;
  /** No target comes from a business case: the person types them (spec 5.4, Review Focus 5). */
  noCase: boolean;
  /** The MAP's line: the share of the horizon's activities done, and its health. Automatic, read-only. */
  map?: { done: number; total: number; health: MapHealth | null };
  readOnly?: boolean;
  onChange?: (key: ScoreKey, patch: ScorePatch) => MapApplyOutcome;
}) {
  const editable = !readOnly && onChange !== undefined;
  return (
    <div className="min-w-0">
      {noCase && (
        <p className="mb-3 text-sm text-ink-2">
          <span className="font-medium text-ink">{COPY.REVIEW_NO_CASE}</span>. {COPY.REVIEW_NO_CASE_TEXT}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm print:min-w-0">
          <thead className="text-xs tracking-wide text-ink-3 uppercase">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-medium">{COPY.REVIEW_NUMBER}</th>
              <th scope="col" className="pr-3 font-medium">{COPY.REVIEW_ACTUAL}</th>
              <th scope="col" className="pr-3 font-medium">{COPY.REVIEW_TARGET}</th>
              <th scope="col" className="font-medium">{COPY.REVIEW_OF_TARGET}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <ScoreLine key={row.key} row={row} currency={currency} editable={editable} onChange={(patch) => onChange!(row.key, patch)} />
            ))}
            {map && (
              <tr className="align-top">
                <th scope="row" className="py-2 pr-3 font-medium">{COPY.REVIEW_MAP_DONE}</th>
                <td colSpan={3} className="py-2">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">{COPY.REVIEW_MAP_DONE_VALUE(map.done, map.total)}</span>
                    {map.health && <HealthBadge health={map.health} />}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScoreLine({ row, currency, editable, onChange }: {
  row: ScoreRow; currency: Currency | null; editable: boolean; onChange: (patch: ScorePatch) => MapApplyOutcome;
}) {
  const percent = scorePercent(row.key, row.actual, row.target);
  const show = (value: number) => formatScore(row.key, value, currency);
  const money = isMoney(row.key);
  // Money is whole: the prefill offered is saved as shown.
  const suggestion = row.suggestion === null ? null : money ? Math.round(row.suggestion) : row.suggestion;
  const field = money ? { sign: currency ? CURRENCY_SIGN[currency] : null } : undefined;
  return (
    <tr className="align-top">
      <th scope="row" className="py-2 pr-3 font-normal">
        <span className="block font-medium break-words">{row.label}</span>
        {editable ? (
          <div className="mt-1 grid gap-1">
            <PillSelect label={COPY.REVIEW_SOURCE_OF(row.label)} value={row.source ?? ''} className="h-7 w-fit"
              options={[['', COPY.REVIEW_NO_SOURCE], ...CASE_SOURCES.map((s) => [s, COPY.REVIEW_SOURCE_LABELS[s]] as const)]}
              onChange={(source) => onChange({ source: (source || null) as CaseSource | null })} />
            <InlineText value={row.note} label={COPY.REVIEW_NOTE_OF(row.label)} field="note" placeholder={COPY.MAP_ADD_NOTE}
              className="text-xs text-ink-2" onCommit={(note) => onChange({ note })} />
          </div>
        ) : (
          (row.source || row.note) && (
            <span className="mt-0.5 block text-xs text-ink-3 break-words">
              {[row.source ? COPY.REVIEW_SOURCE_LABELS[row.source] : '', row.note].filter(Boolean).join(' · ')}
            </span>
          )
        )}
      </th>
      <td className="py-2 pr-3">
        {editable ? (
          <>
            <NumberField value={row.actual} label={COPY.REVIEW_ACTUAL_OF(row.label)} money={field} onCommit={(actual) => onChange({ actual })} />
            {row.actual === null && suggestion !== null && (
              <button type="button" onClick={() => onChange({ actual: suggestion })}
                className="mt-1 rounded-md px-1 text-xs font-medium text-brand-strong underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {COPY.REVIEW_USE_VALUE(show(suggestion))}
              </button>
            )}
          </>
        ) : (
          <span className="tabular-nums">{row.actual === null ? '' : show(row.actual)}</span>
        )}
      </td>
      <td className="py-2 pr-3">
        {editable
          ? <NumberField value={row.target} label={COPY.REVIEW_TARGET_OF(row.label)} money={field} onCommit={(target) => onChange({ target })} />
          : <span className="tabular-nums">{row.target === null ? '' : show(row.target)}</span>}
      </td>
      <td className="py-2 tabular-nums text-ink-2">{percent === null ? '' : `${percent}%`}</td>
    </tr>
  );
}

/**
 * A number typed by hand: saved on Enter or when the field is left; text such as "12k" is refused with why. Money
 * (`money`) shows whole, with the currency's sign before it when there is one.
 */
export function NumberField({ value, label, money, onCommit, className }: {
  value: number | null; label: string; money?: { sign: string | null } | undefined; onCommit: (value: number | null) => MapApplyOutcome;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseAmount(draft);
    if (parsed === 'invalid') {
      setError(COPY.REVIEW_NOT_A_NUMBER);
      return;
    }
    setDraft(null);
    setError(null);
    if (parsed === value) return;
    const out = onCommit(parsed);
    if (!out.ok) setError(Object.values(out.fieldErrors ?? {})[0] ?? out.message);
  };
  const shown = value !== null && money ? Math.round(value) : value;
  return (
    <div className={cn('w-28', className)}>
      <div className="flex items-center gap-1">
        {money?.sign && <span aria-hidden className="shrink-0 text-xs text-ink-3">{money.sign}</span>}
        <input type="text" inputMode="decimal" aria-label={label} aria-invalid={error ? true : undefined}
          value={draft ?? fieldAmount(shown)}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setDraft(null);
              setError(null);
            }
          }}
          className={cn(fieldControl, 'h-8 min-w-0 text-right tabular-nums')} />
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
