import { COPY } from '@partner-desk/copy';
import type { UpdateStatus } from '@/server/update-check';

/** A company server's version and, when a newer release is out, the update notice (plan 17, task 5). Admins only. */
export function VersionPanel({ status, howToUpdate }: { status: UpdateStatus; howToUpdate: string }) {
  return (
    <div className="text-sm">
      <p>{COPY.VERSION_RUNNING(status.current)}</p>
      {status.update && (
        <p role="status" className="mt-2 font-medium text-brand-strong">
          {COPY.UPDATE_AVAILABLE(status.update.version)}{' '}
          <a className="underline underline-offset-2" href={status.update.url} target="_blank" rel="noreferrer">{COPY.UPDATE_WHATS_NEW}</a>
          {' · '}
          <a className="underline underline-offset-2" href={howToUpdate} target="_blank" rel="noreferrer">{COPY.UPDATE_HOW}</a>
        </p>
      )}
    </div>
  );
}
