'use client';

import type { Currency } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { CURRENCY_SIGN } from './format';
import { NumericInput, type NumericInputProps } from './number-input';

export { CURRENCY_SIGN, formatMoney } from './format';

/** An amount in the company's currency, the sign before the number; `unit` after it, such as `a year`. */
export function MoneyInput({ currency, unit, ...props }: NumericInputProps & { currency: Currency; unit?: string }) {
  return <NumericInput {...props} prefix={CURRENCY_SIGN[currency]} suffix={unit} inputMode="decimal" />;
}

/** An amount that may be left empty: empty is `null` ("not known"), and the placeholder says so. */
export function OptionalMoneyInput({ value, onChange, placeholder = COPY.NOT_KNOWN, ...props }: Omit<NumericInputProps, 'value' | 'onChange'> & {
  currency: Currency; value: number | null; onChange: (n: number | null) => void;
}) {
  return (
    <MoneyInput {...props} placeholder={placeholder} value={value ?? NaN}
      onChange={(n, typed) => onChange(typed.trim() === '' ? null : n)} />
  );
}
