'use client';

// Settings' Trash on a company server (plan 16): what people deleted, the latest first, each with Restore or the reason
// it can't come back. Admins only.
import type { TrashItem } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { useId, useRef, useState, useTransition } from 'react';
import { Button } from '@/ui/button';
import { dayIn, EmptyLine, Facts } from './agents-shared';
import { restoreTrashItem } from './trash-actions';

export function TrashPanel({ initial, timeZone }: { initial: TrashItem[]; timeZone: string }) {
  const [items, setItems] = useState(initial);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startPending] = useTransition();
  const noteRef = useRef<HTMLParagraphElement>(null);

  const restore = (item: TrashItem) => startPending(async () => {
    setNote(null);
    try {
      const out = await restoreTrashItem(item.fileId);
      if (out.items) setItems(out.items);
      setNote({ ok: out.ok, message: out.message });
      // The row and its button are gone: the line saying what happened takes the focus.
      requestAnimationFrame(() => noteRef.current?.focus());
    } catch {
      setNote({ ok: false, message: COPY.SETTINGS_WRONG });
    }
  });

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-3">{COPY.TRASH_HINT}</p>
      {items.length === 0 ? <EmptyLine>{COPY.TRASH_NONE}</EmptyLine> : (
        <ul aria-labelledby="trash-heading" className="divide-y divide-line">
          {items.map((item) => <TrashRow key={item.fileId} item={item} timeZone={timeZone} disabled={pending} onRestore={() => restore(item)} />)}
        </ul>
      )}
      {note && (
        <p ref={noteRef} tabIndex={-1} role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-sm text-ink-2 outline-none' : 'text-sm text-danger outline-none'}>
          {note.message}
        </p>
      )}
    </div>
  );
}

function TrashRow({ item, timeZone, disabled, onRestore }: { item: TrashItem; timeZone: string; disabled: boolean; onRestore: () => void }) {
  const nameId = useId();
  return (
    <li aria-labelledby={nameId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0">
      <div className="min-w-0 flex-1 basis-48">
        <p id={nameId} className="truncate text-sm font-medium">{item.name}</p>
        <Facts items={[COPY.TRASH_KIND[item.kind], COPY.TRASH_DELETED_ON(dayIn(item.deletedAt, timeZone)), ...(item.blocked ? [item.blocked] : [])]} />
      </div>
      {!item.blocked && (
        <Button size="sm" variant="ghost" aria-label={`${COPY.TRASH_RESTORE} ${item.name}`} disabled={disabled} onClick={onRestore}>{COPY.TRASH_RESTORE}</Button>
      )}
    </li>
  );
}
