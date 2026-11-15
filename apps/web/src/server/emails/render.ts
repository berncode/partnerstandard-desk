import { render } from 'react-email';
import type { ReactElement } from 'react';

export interface RenderedEmail { subject: string; html: string; text: string }

export const SUBJECT_MAX = 200;

/** A subject is one line: whitespace runs (newlines included) collapse, and a long text is cut with an ellipsis. Cuts by code points, so an emoji is never split. */
export function singleLine(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/**
 * One template, both bodies (spec §4.1: React Email). The plain text is rendered from the same element, so the two
 * never drift. Links come out as "label https://…", which is also how e2e finds them.
 */
export async function renderEmail(element: ReactElement, subject: string): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: singleLine(subject, SUBJECT_MAX), html, text };
}
