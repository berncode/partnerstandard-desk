'use client';

import { NumericInput, type NumericInputProps } from './number-input';

/** A percentage, 0 to 100. `unit` shows after the number: `%` unless it says more, such as `% a year`. */
export function PercentInput({ unit = '%', ...props }: NumericInputProps & { unit?: string }) {
  return <NumericInput {...props} suffix={unit} inputMode="decimal" />;
}
