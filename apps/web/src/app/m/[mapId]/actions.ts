'use server';

// A link holder's save, and Sign out. The link, so the MAP and the side, come from the cookie, checked again on every
// call; never from input.
import { changeMap, endMapSession, invalid, readMap } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { snapshotOf, type RemoteResult } from '@/maps/remote';
import { isMapId, mapCookieName } from '@/server/map-session';
import { currentLinkHolder, mapAccessDeps, pauseMapForAuth } from '@/server/runtime';

const changeInput = z.object({ mapId: z.string().refine(isMapId), change: z.unknown() }).strict();

/** Refusals the person can act on, in the MAP's own words. Anything else is about the owner's files: never shown. */
const SHOWN = new Set<string>(['conflict', 'forbidden', 'invalid', 'not_found']);

/** Ends this browser's session of the MAP: on our side, and its cookie. */
async function endHere(id: string, sessionToken: string): Promise<void> {
  await endMapSession(mapAccessDeps(), sessionToken, id);
  (await cookies()).delete(mapCookieName(id));
}

/**
 * One change from the link holder's MAP page, through the same command as the owner's (one way in). Refused or in
 * conflict, it comes back with the MAP read again, as the owner's page does. A MAP that is gone for them (deleted, its
 * partner type removed, its owner gone) ends the session.
 */
export async function mapLinkChange(input: unknown): Promise<RemoteResult> {
  const parsed = changeInput.safeParse(input);
  if (!parsed.success) return { ...invalid(), ok: false };
  const holder = await currentLinkHolder(parsed.data.mapId);
  if (holder.kind !== 'active') {
    return { ok: false, error: 'auth', message: holder.kind === 'revoked' ? COPY.LINK_ACCESS_REMOVED : COPY.LINK_ACCESS_ENDED };
  }
  const out = await changeMap(holder.deps, holder.actor, parsed.data);
  if (out.ok) {
    const { snapshot, entityId, record, startedOn, lastProgressAt } = out.value;
    return { ok: true, snapshot: { ...snapshot, record, startedOn, lastProgressAt }, entityId };
  }
  if (out.error === 'file_not_found') {
    await endHere(parsed.data.mapId, holder.sessionToken);
    return { ok: false, error: 'auth', message: COPY.LINK_ACCESS_ENDED };
  }
  if (!SHOWN.has(out.error)) {
    // The owner's Google access is broken: the MAP's emails pause and its owner is told, once (the MAP app's pauseForAuth).
    if (out.error === 'auth') pauseMapForAuth(parsed.data.mapId);
    return { ok: false, error: 'unavailable', message: COPY.LINK_MAP_UNAVAILABLE };
  }
  const fresh = await readMap(holder.deps, holder.actor, { mapId: parsed.data.mapId });
  return {
    ok: false, error: out.error, message: out.message, ...(out.fieldErrors ? { fieldErrors: out.fieldErrors } : {}),
    ...(fresh.ok ? { snapshot: snapshotOf(fresh.value) } : {}),
  };
}

/** Sign out: ends the session here and on our side. The link still works. */
export async function leaveMap(form: FormData): Promise<void> {
  const id = form.get('mapId');
  if (isMapId(id)) {
    const sessionToken = (await cookies()).get(mapCookieName(id))?.value;
    if (sessionToken) await endHere(id, sessionToken);
  }
  redirect('/c/signed-out');
}
