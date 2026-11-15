/** Company names are trimmed and at most this many characters. */
export const COMPANY_NAME_MAX = 80;

/** A company name after cleaning: the name to store ('' for none), or a refusal and why, so each gets its own message. */
export type CleanedName = { ok: true; value: string } | { ok: false; reason: 'too_long' | 'invalid' };

const CONTROL = /[\u0000-\u001f\u007f]/;

/** The company name to store: trimmed, at most 80 characters as people count them. Empty or only spaces means no name. */
export function cleanCompanyName(value: unknown): CleanedName {
  if (value === null || value === undefined) return { ok: true, value: '' };
  if (typeof value !== 'string' || CONTROL.test(value)) return { ok: false, reason: 'invalid' };
  const name = value.trim();
  return [...name].length <= COMPANY_NAME_MAX ? { ok: true, value: name } : { ok: false, reason: 'too_long' };
}
