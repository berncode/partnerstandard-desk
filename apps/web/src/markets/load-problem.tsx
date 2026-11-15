import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { ReconnectButton } from '@/problems/reconnect';
import { buttonVariants } from '@/ui/button';
import type { StorageKind } from '@/storage-kind';

/**
 * A page's read was refused: its message, and for an expired Google sign-in a Reconnect Google button that brings the
 * person back to `next`. `partnersFile`: the refused read was the Partners file's; when that file is gone, or was made
 * by an earlier test version, the line says so and points to Partners, which offers a new one (FileProblem).
 */
export function LoadProblem({ failure, next, storage, partnersFile = false }: {
  failure: { error: string; message: string }; next: string; storage: StorageKind; partnersFile?: boolean;
}) {
  const partnersGone = partnersFile && failure.error === 'file_not_found';
  const partnersOld = partnersFile && failure.error === 'old_version';
  const line = partnersGone ? COPY.PARTNERS_FILE_GONE_LINE : partnersOld ? COPY.PARTNERS_FILE_OLD_LINE : failure.message;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
      <p className="min-w-0 flex-1">{line}</p>
      {(partnersGone || partnersOld) && <Link href="/partners" className={buttonVariants({ variant: 'primary' })}>{COPY.GO_TO_PARTNERS}</Link>}
      {failure.error === 'auth' && <ReconnectButton next={next} storage={storage} />}
    </div>
  );
}
