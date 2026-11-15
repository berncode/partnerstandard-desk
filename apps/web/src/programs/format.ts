import { CURRENCY_SYMBOL } from '@partner-desk/core';

/**
 * How numbers are shown in the inputs. Not a client module, so server-rendered pages can format on the server; the
 * inputs re-export these. Amounts in sentences use the domain's formatMoney and formatPerOne (src/domain/calculate.ts),
 * so a screen and the Program Sheet say the same.
 */

export { formatMoney, formatPerOne } from '@partner-desk/core';

/** The sign shown before an amount in an input. */
export const CURRENCY_SIGN = CURRENCY_SYMBOL;

const display = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A number with thousands separators, as the inputs show it; empty when it isn't a number. */
export const formatNumber = (n: number): string => (Number.isFinite(n) ? display.format(n) : '');
