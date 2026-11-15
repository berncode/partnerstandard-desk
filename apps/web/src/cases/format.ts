import type { Currency } from '@partner-desk/core';

/**
 * How amounts and numbers are shown everywhere. Not a client module, so server-rendered pages (the one-page case) can
 * format on the server; the inputs re-export these.
 */

/** The sign shown before an amount. */
export const CURRENCY_SIGN: Record<Currency, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A whole amount with its sign before it, as the inputs show it: €24,000, $4,000, CHF 1,500, -€800. */
export function formatMoney(n: number, currency: Currency): string {
  const rounded = Math.round(n);
  const sign = CURRENCY_SIGN[currency];
  return `${rounded < 0 ? '-' : ''}${sign}${sign.length > 1 ? ' ' : ''}${grouped.format(Math.abs(rounded))}`;
}

const display = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A number with thousands separators, as the inputs show it; empty when it isn't a number. */
export const formatNumber = (n: number): string => (Number.isFinite(n) ? display.format(n) : '');
