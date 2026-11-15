'use client';

// Google Sheets only, words from COPY.
import { COPY } from '@partner-desk/copy';
import { Info, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/ui/button';
import type { AttentionItem } from './market-model';

/** Rows of the sheet the market page can't use, listed at the top. The sheet keeps them as they are. */
export function NeedsAttention({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div role="note" className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{COPY.NEEDS_ATTENTION_TITLE}</p>
        <p className="mt-0.5">{COPY.NEEDS_ATTENTION_TEXT}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {items.map((item, index) => (
            <li key={`${item.where}-${index}`} className="break-words">
              <span className="font-medium">{item.where}:</span> {item.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The hint on a row the page shows: the row stays editable. */
export function NeedsAttentionHint({ messages }: { messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <p role="note" className="mt-1.5 flex items-start gap-1.5 text-xs text-warn">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{COPY.NEEDS_ATTENTION_HINT(messages.join(' · '))}</span>
    </p>
  );
}

/** After a new market opens: some of the first partners typed in the flow weren't added. */
export function FirstPartnersNotice({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{COPY.FIRST_PARTNERS_NOT_ADDED(count)}</p>
      <Button variant="ghost" size="icon" className="h-6 w-6 text-warn" aria-label={COPY.DISMISS} onClick={onDismiss}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}
