// The helpers both aggregates use.
import { z } from 'zod';
import { FOUR_C } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';

/** Google Sheets refuses cells over 50,000 characters; text fields stop at 45,000. */
export const TEXT_MAX = 45_000;
export const TOO_LONG = COPY.TOO_LONG;

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export const isoDateSchema = z.string().refine(isValidIsoDate, { message: COPY.INVALID_DATE });
export const idSchema = z.string().min(1);
export const updatedAtSchema = z.string().nullable();
export const updatedBySchema = z.string().min(1);
export const text = z.string().max(TEXT_MAX, TOO_LONG);
export const required = (label: string) => z.string().trim().min(1, COPY.REQUIRED(label)).max(TEXT_MAX, TOO_LONG);
export const scoreSchema = z.literal([0, 1, 2, 3], { message: COPY.INVALID_SCORE }).nullable();

export function fieldsOf<K extends string, T extends z.ZodType>(keys: readonly K[], schema: T) {
  return z.object(Object.fromEntries(keys.map((key) => [key, schema])) as Record<K, T>);
}
export const scoresSchema = fieldsOf(FOUR_C, scoreSchema);

/** First message per field path, e.g. `{ 'desk.credibility': COPY.INVALID_SCORE }`. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
