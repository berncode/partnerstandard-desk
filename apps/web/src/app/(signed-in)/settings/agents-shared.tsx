import { levelWithinRole, type AgentLevel } from '@partner-desk/commands';
import type { WorkspaceRole } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { ReactNode } from 'react';
import { dayIn } from '@/ui/dates';

/** API keys shown at the level they really have: a company server's viewer's read only (plan 15). */
export function withinRole<T extends { level: AgentLevel }>(rows: readonly T[], role: WorkspaceRole | undefined): T[] {
  return rows.map((row) => ({ ...row, level: levelWithinRole(row.level, role) }));
}

/** The longest key name: an agent's own name is cut there (`agentContext`); Settings shows it. */
export const MAX_KEY_NAME = 40;

/**
 * A dialog that shows a key or a secret once: an outside click or Escape doesn't close it, so it isn't lost by a slip.
 * Done and the close button do.
 */
export const KEEP_OPEN = {
  onInteractOutside: (event: Event) => event.preventDefault(),
  onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
};

/** A level as the allow page names it. */
export const LEVEL_LABEL: Record<AgentLevel, string> = {
  read: COPY.AGENT_LEVEL_READ, change: COPY.AGENT_LEVEL_CHANGE, propose: COPY.AGENT_LEVEL_PROPOSE,
};

// Dates in the person's timezone (Settings): the shared helpers, kept under their old names here for the settings lists.
export { dayIn, timeIn } from '@/ui/dates';

/** What a row says about when it was last used. */
export const lastUsed = (iso: string | null, timeZone: string): string => (iso ? COPY.AGENTS_LAST_USED(dayIn(iso, timeZone)) : COPY.AGENTS_NOT_USED);

/** One of the card's three lists: a small heading, a line under it, and its action on the right. */
export function SubSection({ id, title, hint, action, children }: {
  id: string; title: string; hint?: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 border-t border-line pt-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <h3 id={id} className="text-sm font-semibold">{title}</h3>
          {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** The line a list shows while it is empty. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-3">{children}</p>;
}

/** Facts in a row, apart by a middle dot. */
export function Facts({ items }: { items: string[] }) {
  return <p className="text-xs text-ink-3">{items.join(' · ')}</p>;
}
