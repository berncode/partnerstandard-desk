// The proposals the person answered on this visit, since the sidebar's count was read: the layout isn't read again on
// a page change, so the count takes these off until the next read brings a new one. Ids only, in memory, this tab only.
const answered = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

/** A proposal the person accepted or rejected: the sidebar's count goes down by one. */
export function noteAnswered(proposalId: string): void {
  if (answered.has(proposalId)) return;
  answered.add(proposalId);
  emit();
}

/** The read the count on screen came from: the same read seen again (the phone menu mounts its count anew) keeps the answers. */
let lastRead: string | null = null;

/**
 * A count read from the server (`read`: when it was read): a new read holds every answer so far, so they are cleared;
 * the same read seen again by another copy of the count changes nothing.
 */
export function syncRead(read: string): void {
  if (read === lastRead) return;
  lastRead = read;
  if (answered.size === 0) return;
  answered.clear();
  emit();
}

export function subscribeAnswered(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const answeredCount = (): number => answered.size;
