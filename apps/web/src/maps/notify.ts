// The MAP page's toasts, in COPY's words.
import { COPY } from '@partner-desk/copy';
import { toast } from 'sonner';

const UNDO_TOAST_ID = 'map-undo';

export interface Notify {
  /** Shows the undo toast (there is only one; a new one replaces it). */
  undo(label: string, onUndo: () => void): void;
  /** Removes the undo toast, e.g. once the change it would undo can no longer be undone. */
  dismissUndo(): void;
  /** An error toast; with `onAction`, it carries a button labelled `actionLabel` (Retry unless given). */
  error(message: string, onAction?: () => void, actionLabel?: string): void;
  info(message: string): void;
}

export const sonnerNotify: Notify = {
  undo(label, onUndo) {
    toast(label, { id: UNDO_TOAST_ID, duration: 5000, action: { label: COPY.UNDO, onClick: onUndo } });
  },
  dismissUndo() {
    toast.dismiss(UNDO_TOAST_ID);
  },
  error(message, onAction, actionLabel = COPY.RETRY) {
    toast.error(message, onAction ? { action: { label: actionLabel, onClick: onAction } } : undefined);
  },
  info(message) {
    toast(message);
  },
};
