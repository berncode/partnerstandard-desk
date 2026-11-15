'use client';

import { useState } from 'react';
import { cn } from '@/ui/cn';
import { Field } from './field';
import { formatNumber } from './format';

/** Thousands marks: groups of exactly three digits after at least one digit. */
const grouped = (digits: string, mark: ',' | '.') =>
  new RegExp(`^\\d+(?:\\${mark}\\d{3})+$`).test(digits) ? digits.replaceAll(mark, '') : null;

/**
 * What people type, read back as a number, in English or European style. Currency signs, % and spaces are ignored.
 * With both `.` and `,` the later one is the decimal mark. With only commas, commas before groups of three digits are
 * thousands marks (1,234), else a single comma is the decimal mark (12,5). With only dots, one dot is the decimal mark
 * (1.5), several before groups of three are thousands marks (1.234.567). A leading minus is kept. Anything else is NaN.
 */
export function parseNumber(text: string): number {
  let s = text.replace(/CHF|[€$£%\s]/gi, '');
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let plain: string | null;
  if (lastDot >= 0 && lastComma >= 0) {
    const [decimal, thousands] = lastDot > lastComma ? (['.', ','] as const) : ([',', '.'] as const);
    const at = s.lastIndexOf(decimal);
    const whole = grouped(s.slice(0, at), thousands);
    const fraction = s.slice(at + 1);
    plain = whole !== null && /^\d*$/.test(fraction) ? `${whole}.${fraction}` : null;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const mark = lastComma >= 0 ? ',' : '.';
    const marks = s.split(mark).length - 1;
    const thousands = (mark === ',' || marks > 1) ? grouped(s, mark) : null;
    // A single mark not before a group of three is the decimal mark; "12," while typing reads as 12.
    plain = thousands ?? (marks === 1 && /^\d+[.,]\d*$/.test(s) ? s.replace(mark, '.') : null);
  } else {
    plain = s;
  }
  if (plain === null) return NaN;
  const n = Number(plain);
  return negative ? -n : n;
}

export { formatNumber } from './format';

/** The props every number input shares. */
export interface NumericInputProps {
  id: string;
  /** One line. With `labelHidden`, a column heading shows it and the label is for screen readers only. */
  label: string;
  value: number;
  /** The number read from what is typed (NaN when it isn't one), and the text itself. */
  onChange: (n: number, typed: string) => void;
  /** A short line under the control. */
  caption?: string;
  /** What is wrong, in place of the caption. With `labelHidden` the caller shows it (under its grid row) and passes `describedBy`. */
  error?: string;
  labelHidden?: boolean;
  describedBy?: string;
  /** Marks the control as wrong while the caller shows what is wrong elsewhere (under its row), described by `describedBy`. */
  invalid?: boolean;
  className?: string;
  /** Numbers are right-aligned; a row of short counts (deals per year) centers them under centered labels. */
  align?: 'right' | 'center';
  /** Shown while the field is empty, such as `not known`. */
  placeholder?: string;
  /** Grayed out and not editable; the number stays shown. */
  disabled?: boolean;
}

/** The box of a number control: sign before or unit after, right-aligned tabular figures. The sign and unit are visual: the label names the field. */
export const numericBox =
  'flex h-9 w-full min-w-0 items-center rounded-lg border border-line bg-surface text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30';

/**
 * A number field: shows `value` with thousands separators, and while focused what is typed, read back on every
 * keystroke. Leaving the field formats it again, unless what was typed isn't a number (it stays, to be fixed).
 */
export function NumericInput({ id, label, value, onChange, caption, error, labelHidden, describedBy, invalid, className, align = 'right', placeholder, disabled, prefix, suffix, inputMode }: NumericInputProps & {
  prefix?: string; suffix?: string; inputMode: 'numeric' | 'decimal';
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const wrong = Boolean(error) || invalid;
  const control = (described?: string) => (
    <span className={cn(numericBox, wrong && 'border-danger', disabled && 'bg-surface-2 text-ink-3', className)}>
      {prefix && <span aria-hidden className="shrink-0 pl-2.5 text-ink-3">{prefix}</span>}
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        aria-label={labelHidden ? label : undefined}
        aria-invalid={wrong ? true : undefined}
        aria-describedby={described}
        placeholder={placeholder}
        disabled={disabled}
        className={cn('h-full w-full min-w-0 bg-transparent px-2 tabular-nums text-ink outline-none placeholder:text-ink-3 disabled:text-ink-3', align === 'center' ? 'text-center' : 'text-right')}
        value={typed ?? formatNumber(value)}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange(parseNumber(event.target.value), event.target.value);
        }}
        onBlur={() => {
          if (typed !== null && Number.isFinite(parseNumber(typed))) setTyped(null);
        }}
      />
      {suffix && <span aria-hidden className="shrink-0 whitespace-nowrap pr-2.5 text-ink-3">{suffix}</span>}
    </span>
  );
  if (labelHidden) return control(describedBy);
  return <Field label={label} error={error} hint={caption} center={align === 'center'}>{(described) => control(described ?? describedBy)}</Field>;
}

/** A count, such as deals a year or users per customer. `unit` shows after the number. */
export function NumberInput({ unit, ...props }: NumericInputProps & { unit?: string }) {
  return <NumericInput {...props} suffix={unit} inputMode="decimal" />;
}
