import { COPY } from '@partner-desk/copy';
import { continueWithGoogle } from '@/app/sign-in/actions';
import { Button } from '@/ui/button';
import { canReconnectGoogle, type StorageKind } from '@/storage-kind';

/**
 * Reconnect Google: starts Google's sign-in on the server and brings the person back to `next`. Only for a Google
 * account (a test account has nothing to reconnect). We never revoke the grant; this asks for it again.
 */
export function ReconnectButton({ next, storage }: { next: string; storage: StorageKind }) {
  if (!canReconnectGoogle(storage)) return null;
  return (
    <form action={continueWithGoogle}>
      <input type="hidden" name="next" value={next} />
      <Button type="submit" variant="primary">{COPY.RECONNECT_BUTTON}</Button>
    </form>
  );
}
