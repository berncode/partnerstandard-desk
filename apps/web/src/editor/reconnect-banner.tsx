// The reconnect banner is for Google only, and its button starts Google on the server (`continueWithGoogle`), as the sign-in page does.
import { COPY, copyFor } from '@partner-desk/copy';
import { continueWithGoogle } from '@/app/sign-in/actions';
import { buttonVariants } from '@/ui/button';
import { canReconnectGoogle, type StorageKind } from '@/storage-kind';
import { useViewer } from '@/storage-context';
import { ViewerLine } from '@/viewer-read-only';

/**
 * A save answered `auth`: Google needs reconnecting, or the person was signed out. The page stays on screen, read-only,
 * until they sign in again; `next` is where Google brings them back. Test users (files in memory) get no button, and a
 * company server, which has no Google to reconnect, says to sign in again and links its sign-in page (plans 13 and 14).
 */
export function ReconnectBanner({ next, storage }: { next: string; storage: StorageKind }) {
  // A company server's viewer reads and changes nothing (plan 15): their page says so, with no way "back" to offer.
  const viewer = useViewer();
  if (viewer) return <ViewerLine />;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
      <p className="min-w-0 flex-1">
        <span className="font-medium">{copyFor(storage).RECONNECT_TITLE}</span> {COPY.RECONNECT_TEXT}
      </p>
      {/* A company server signs in again by email link, on the sign-in page (plan 14). */}
      {storage === 'database' && (
        <a href={`/sign-in?next=${encodeURIComponent(next)}`} className={buttonVariants({ variant: 'primary' })}>{COPY.SIGN_IN_AGAIN}</a>
      )}
      {canReconnectGoogle(storage) && (
        <form action={continueWithGoogle}>
          <input type="hidden" name="next" value={next} />
          {/* The banner shows after a save failed: focus moves to the one way out. */}
          <button type="submit" autoFocus className={buttonVariants({ variant: 'primary' })}>{COPY.RECONNECT_BUTTON}</button>
        </form>
      )}
    </div>
  );
}
