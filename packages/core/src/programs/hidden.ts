import { newProgram } from './new-program';
import type { CompanyFacts, Program } from './types';
import { parseProgram } from './validate';

/**
 * The answers the steps don't show for this program, as paths: the Preferred step's when there is no Preferred
 * level, the certified people when that requirement is off, and the money answers its pay model doesn't ask for
 * (money-step.tsx and rates-table.tsx show the rest). A rate's path names its level and row (`money.rates.pref.1`).
 */
export function hiddenPaths(p: Program, company: Pick<CompanyFacts, 'once'>): string[] {
  const m = p.money;
  const hidden: string[] = [];
  const tiers = p.prefOn ? ['reg', 'pref'] : ['reg'];
  if (!p.prefOn) {
    hidden.push('prefName', 'prefReq', 'bars', 'notice', 'plan', 'pilots', 'publish', 'money.rates.pref', 'money.fee.pref');
  } else if (!p.prefReq.certified.on) {
    hidden.push('prefReq.certified.people');
  }
  const rates = (...index: number[]) => tiers.flatMap((t) => index.map((i) => `money.rates.${t}.${i}`));
  if (m.model === 'none') hidden.push('money.rates', 'money.fee', 'money.years', 'money.payDays');
  if (m.model === 'fee') hidden.push('money.rates', 'money.years');
  if (m.model === 'margin') hidden.push('money.fee', 'money.years', ...rates(1, 2));
  if (m.model === 'commission') {
    hidden.push('money.fee');
    if (m.pattern === 'oneoff') hidden.push(...rates(1));
    if (m.pattern !== 'oneoff' || m.base !== 'contract') hidden.push('money.years');
    if (!((Number(company.once) || 0) > 0)) hidden.push(...rates(2));
  }
  return hidden;
}

const within = (path: string, hidden: string) => path === hidden || path.startsWith(`${hidden}.`);

const valueAt = (from: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((at, key) => (at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), from);

function setAt(target: Program, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce<Record<string, unknown>>((at, key) => at[key] as Record<string, unknown>, target as unknown as Record<string, unknown>);
  parent[last] = structuredClone(value);
}

/**
 * The program to save: an answer the screen doesn't show that has a mistake in it (a Preferred rate of 150 left
 * behind when the level was removed) takes the last saved answer instead, or the starting one when none was saved,
 * so a mistake the owner can't see never stops the save. Shown answers, and hidden ones without a mistake, are kept
 * as they are on screen.
 */
export function keepHiddenSaved(p: Program, saved: Program | null, company: CompanyFacts): Program {
  const parsed = parseProgram(p);
  if (parsed.ok) return p;
  const hidden = hiddenPaths(p, company);
  const wrong = new Set(parsed.issues.flatMap(({ path }) => hidden.filter((h) => within(path, h))));
  if (wrong.size === 0) return p;
  const savedCheck = saved ? parseProgram(saved) : null;
  const savedIssues = savedCheck && !savedCheck.ok ? savedCheck.issues : [];
  const fixed = structuredClone(p);
  for (const path of wrong) {
    const before = saved ? valueAt(saved, path) : undefined;
    const usable = before !== undefined && !savedIssues.some((issue) => within(issue.path, path));
    setAt(fixed, path, usable ? before : valueAt(newProgram(p.type, company, { id: p.id, companyName: '' /* the name is never a hidden answer, so this fallback is never shown */ }), path));
  }
  return fixed;
}
