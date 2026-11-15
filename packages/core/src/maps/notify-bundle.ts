import type { NudgeItem } from './notify-evaluate';

/** One recipient's reminders for one email (spec §5.1: one nudge email per recipient per day, across plans). */
export interface RecipientBundle { email: string; personName: string; items: NudgeItem[] }

function byUrgency(a: NudgeItem, b: NudgeItem): number {
  if (a.kind !== b.kind) return a.kind === 'overdue' ? -1 : 1;
  if (a.days !== b.days) return a.kind === 'overdue' ? b.days - a.days : a.days - b.days;
  return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

export function bundleByRecipient(items: NudgeItem[]): RecipientBundle[] {
  const byEmail = new Map<string, NudgeItem[]>();
  for (const item of items) byEmail.set(item.email, [...(byEmail.get(item.email) ?? []), item]);
  return [...byEmail.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([email, list]) => {
      const sorted = [...list].sort(byUrgency);
      return { email, personName: sorted[0]!.personName, items: sorted };
    });
}
