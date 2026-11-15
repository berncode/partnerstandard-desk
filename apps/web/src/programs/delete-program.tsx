'use client';

import { COPY } from '@partner-desk/copy';
import type { RemoteOutcome } from '@/editor/remote';
import { DeleteDialog } from '@/ui/delete-dialog';
import { useCopy } from '@/storage-context';

/**
 * Delete program: a confirmation naming it, then the Drive trash. A program that partners or markets point to stays;
 * the dialog says why. `onDeleted` runs once it is gone. Used on Basics and on the Programs page.
 */
export function DeleteProgram({ name, label, remove, onDeleted, size, disabled }: {
  name: string;
  /** The button's name when several show on one page ("Delete Reseller · DACH"). */
  label?: string;
  remove: () => Promise<RemoteOutcome<{ programId: string }>>;
  onDeleted: () => void;
  size?: 'sm';
  disabled?: boolean;
}) {
  const words = useCopy();
  return (
    <DeleteDialog action={COPY.PROG_DELETE} title={COPY.PROG_DELETE_TITLE(name)} text={words.PROG_DELETE_TEXT(name)}
      label={label} remove={remove} onDeleted={onDeleted} size={size} disabled={disabled} />
  );
}
