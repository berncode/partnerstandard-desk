'use client';

// A company server's viewer reads and changes nothing (plan 15). The editors that save as you type (a business case's
// tabs, a program's steps, Company facts) show a viewer their fields as they are, closed: nothing to type that a save
// would then refuse and lose (owner, 2026-11-14). Hosted has no viewer: these add nothing there.
import { COPY } from '@partner-desk/copy';
import type { ReactNode } from 'react';
import { useViewer } from '@/storage-context';
import { cn } from '@/ui/cn';

/** The line that tells a viewer the page is read only, as the MAP and partner pages say it. Nobody else sees it. */
export function ViewerLine({ className }: { className?: string }) {
  const viewer = useViewer();
  if (!viewer) return null;
  return <p role="status" className={cn('rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink-2', className)}>{COPY.VIEWER_LINE}</p>;
}

/**
 * A form's fields, closed for a viewer: a disabled fieldset turns off every input, select, text area and button in it,
 * and `contents` keeps the layout as it is. For everyone else, the children as they are.
 */
export function ClosedForViewer({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  if (!viewer) return children;
  return <fieldset disabled data-testid="closed-for-viewer" className="contents">{children}</fieldset>;
}
