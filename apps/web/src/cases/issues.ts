import { useEffect, useRef, type RefObject } from 'react';
import type { CaseIssue as Issue } from '@partner-desk/core';

/**
 * The issues under `prefix`, with paths relative to it: `offer.types.0.name` within `offer` is `types.0.name`, and an
 * issue about `offer` itself has the path ''. A form that edits one part of a record takes the issues of that part.
 */
export function issuesWithin(issues: Issue[], prefix: string): Issue[] {
  return issues.flatMap((issue) => {
    if (issue.path === prefix) return [{ ...issue, path: '' }];
    return issue.path.startsWith(`${prefix}.`) ? [{ ...issue, path: issue.path.slice(prefix.length + 1) }] : [];
  });
}

/** The message of the issue at `path`, if any. */
export const issueAt = (issues: Issue[], path: string) => issues.find((i) => i.path === path)?.message;

/** The messages of every issue under `prefix` (a row of a list, such as `products.0`). */
export const messagesUnder = (issues: Issue[], prefix: string) =>
  issues.filter((i) => i.path.startsWith(`${prefix}.`)).map((i) => i.message);

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}.`);

/** The value at a dotted path (`types.0.roles.lead`), or undefined. */
function valueAt(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), value);
}

/**
 * `next` with every wrong value under the `hidden` paths put right, for a change that hides those fields (a partner
 * type without services, Preferred switched off): a mistake the owner can no longer see would otherwise stop every
 * save. `issues` are `next`'s, at the same paths. A wrong value goes back to the one at its path in `kept` (the last
 * version without a mistake, see useLastValid), else a number becomes 0 and a text (a cost line's name) "New cost", as
 * a new line starts. Values that are right are kept, so they count again when the field shows again.
 */
export function settleHidden<T>(next: T, hidden: string[], issues: Issue[], kept?: T): T {
  const wrong = issues.filter((issue) => hidden.some((prefix) => under(issue.path, prefix)));
  if (wrong.length === 0) return next;
  const settled = structuredClone(next);
  for (const { path } of wrong) {
    const keys = path.split('.');
    const leaf = keys.pop()!;
    const parent = keys.length > 0 ? valueAt(settled, keys.join('.')) : settled;
    if (!parent || typeof parent !== 'object') continue;
    const record = parent as Record<string, unknown>;
    const before = valueAt(kept, path);
    if (typeof record[leaf] === 'number') record[leaf] = typeof before === 'number' && Number.isFinite(before) ? before : 0;
    else if (typeof record[leaf] === 'string') record[leaf] = typeof before === 'string' && before.trim() ? before : 'New cost';
  }
  return settled;
}

/** The last `value` that was `valid` (as shown on screen), for settleHidden to go back to; undefined until there is one. */
export function useLastValid<T>(value: T, valid: boolean): RefObject<T | undefined> {
  const last = useRef<T | undefined>(valid ? value : undefined);
  useEffect(() => {
    if (valid) last.current = value;
  }, [value, valid]);
  return last;
}
