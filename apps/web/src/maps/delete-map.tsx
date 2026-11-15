'use client';

// New for PartnerStandard Desk (spec 8): Delete for one MAP, asking first, as a business case's card does (DeleteDialog).
import { COPY } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import type { RemoteOutcome } from '@/editor/remote';
import { DeleteDialog } from '@/ui/delete-dialog';
import { useCopy } from '@/storage-context';

export type DeleteMapAction = (input: { mapId: string }) => Promise<RemoteOutcome<{ mapId: string }>>;

/**
 * Delete MAP: a dialog naming the MAP says its file goes to the Drive trash and its links stop working, then
 * `remove` deletes it. After that the page goes to `goTo`, or calls `onDeleted`, or reads itself again. `named`: the
 * button names the MAP, for a list of several.
 */
export function DeleteMap({ mapId, name, remove, goTo, onDeleted, named = false, size }: {
  mapId: string;
  /** "Acme as reseller". */
  name: string;
  remove: DeleteMapAction;
  goTo?: string;
  onDeleted?: () => void;
  named?: boolean;
  size?: 'sm';
}) {
  const words = useCopy();
  const router = useRouter();
  return (
    <DeleteDialog
      size={size}
      action={COPY.MAP_DELETE}
      title={COPY.MAP_DELETE_TITLE(name)}
      text={words.MAP_DELETE_TEXT}
      {...(named ? { label: COPY.MAP_DELETE_NAMED(name) } : {})}
      remove={() => remove({ mapId })}
      onDeleted={() => {
        if (onDeleted) onDeleted();
        else if (goTo) router.push(goTo);
        router.refresh();
      }}
    />
  );
}
