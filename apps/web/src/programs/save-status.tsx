'use client';

import { COPY } from '@partner-desk/copy';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import type { SaveStatus } from './use-autosave';

const TEXT = { idle: '', unsaved: COPY.UNSAVED_CHANGES, saving: COPY.SAVING, saved: COPY.SAVED } as const;

/**
 * What the autosave is doing, with Try again after a failed save, and Reload (when given) once saving has stopped.
 * `loading`: the page is bringing the latest version (after back or forward), and says only that.
 */
export function SaveStatusLine({ status, retry, reload, loading = false, className }: {
  status: SaveStatus; retry: () => void; reload?: () => void; loading?: boolean; className?: string;
}) {
  const failed = !loading && (status.kind === 'error' || status.kind === 'stopped');
  return (
    <div className={cn('flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <p role="status" aria-live="polite" className={cn('text-sm', failed ? 'text-danger' : 'text-ink-3')}>
        {loading ? COPY.LOADING_LATEST : status.kind === 'error' || status.kind === 'stopped' ? status.message : TEXT[status.kind]}
      </p>
      {!loading && status.kind === 'error' && status.retry && <Button size="sm" onClick={retry}>{COPY.TRY_AGAIN}</Button>}
      {!loading && status.kind === 'stopped' && reload && <Button size="sm" variant="primary" onClick={reload}>{COPY.RELOAD}</Button>}
    </div>
  );
}
