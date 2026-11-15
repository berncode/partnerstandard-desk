'use server';

// Settings' Trash on a company server (plan 16): an admin brings back what was deleted.
import { listTrash, restoreFromTrash, type TrashItem } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { actorFor, currentOwner, depsFor } from '@/server/runtime';
import { SIGNED_OUT } from '../actions/context';

/**
 * Restores one item; answers the trash as it is now, and a line to show. A refusal answers the trash too: an item may
 * have changed meanwhile (a MAP started for its partner type).
 */
export async function restoreTrashItem(fileId: unknown): Promise<{ ok: boolean; items: TrashItem[] | null; message: string }> {
  const session = await currentOwner();
  if (!session) return { ...SIGNED_OUT, items: null };
  try {
    const deps = depsFor(session);
    const actor = actorFor(session);
    const out = await restoreFromTrash(deps, actor, { fileId });
    // A trash that can't be read again leaves the list as it was: the restore's answer stands.
    const items = await listTrash(deps, actor, {}).catch(() => null);
    return { ok: out.ok, items: items?.ok ? items.value : null, message: out.ok ? COPY.TRASH_RESTORED(out.value.name) : out.message };
  } catch {
    return { ok: false, items: null, message: COPY.SETTINGS_WRONG };
  }
}
