// Keyed by the MAP: the guided steps' unfinished draft survives a reconnect (a full-page redirect to Google and back).
import { GUIDED_STEPS } from '@partner-desk/method';
import { mapDraftSchema, type MapPlan } from '@partner-desk/core';

/**
 * The draft is kept in this tab's sessionStorage. Session storage dies with the tab, which suits a draft that may hold
 * partner names. The key names the MAP, which only its owner can open. Pure apart from the given Storage, and every
 * call survives a browser that refuses storage.
 */
export const draftKey = (mapId: string) => `pd:map-guided-draft:v1:${mapId}`;

export interface SavedDraft { draft: MapPlan; index: number }

export function saveDraft(storage: Storage | null, mapId: string, value: SavedDraft): void {
  if (!storage) return;
  try {
    storage.setItem(draftKey(mapId), JSON.stringify(value));
  } catch {
    // Full or blocked: the flow works without it.
  }
}

/** The MAP's saved draft and step, or null when there is none or it doesn't pass mapDraftSchema. */
export function loadDraft(storage: Storage | null, mapId: string): SavedDraft | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(draftKey(mapId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { draft, index } = value as { draft?: unknown; index?: unknown };
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= GUIDED_STEPS.length) return null;
  const parsed = mapDraftSchema.safeParse(draft);
  if (!parsed.success) return null;
  return { draft: parsed.data as MapPlan, index };
}

export function clearDraft(storage: Storage | null, mapId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(mapId));
  } catch {
    // Blocked: nothing was saved either.
  }
}
