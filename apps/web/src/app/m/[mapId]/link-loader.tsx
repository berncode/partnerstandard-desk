// The collaborator's side of a MAP, read through the commands.
import { endMapSession, readMap, type MapRead, ownerToday } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { redirect } from 'next/navigation';
import { LinkNotice } from '@/app/c/link-frame';
import { LinkMapPage } from '@/maps/link-page';
import { snapshotOf } from '@/maps/remote';
import { currentLinkHolder, mapAccessDeps, pauseMapForAuth, type CurrentLinkHolder } from '@/server/runtime';

/** Where a link holder whose session is over goes: a route that clears the cookie first (leave/route.ts). */
export const leavePath = (mapId: string, to: 'invalid' | 'removed' | 'renew') => `/m/${mapId}/leave?to=${to}`;

export type LinkRead =
  | { kind: 'ready'; holder: Extract<CurrentLinkHolder, { kind: 'active' }>; read: MapRead }
  | { kind: 'unavailable' };

/**
 * The link holder and their MAP, or a redirect: an expired session to "get a new link", a revoked one to "access
 * removed", anything else to "this link doesn't work". A MAP gone for them (deleted, its partner type taken out of
 * Partners by hand, its owner gone) ends the session first (Review Focus 4). Never the owner's words about files.
 */
export async function readForLink(mapId: string): Promise<LinkRead> {
  const holder = await currentLinkHolder(mapId);
  if (holder.kind === 'expired') redirect(leavePath(mapId, 'renew'));
  if (holder.kind === 'revoked') redirect(leavePath(mapId, 'removed'));
  if (holder.kind === 'none') redirect(leavePath(mapId, 'invalid'));
  const read = await readMap(holder.deps, holder.actor, { mapId });
  if (read.ok) return { kind: 'ready', holder, read: read.value };
  if (read.error === 'file_not_found') {
    await endMapSession(mapAccessDeps(), holder.sessionToken, mapId);
    redirect(leavePath(mapId, 'invalid'));
  }
  // The owner's Google access is broken: the MAP's emails pause and its owner is told, once.
  if (read.error === 'auth') pauseMapForAuth(mapId);
  return { kind: 'unavailable' };
}

export async function LinkMapLoader({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  const found = await readForLink(mapId);
  if (found.kind === 'unavailable') return <LinkNotice title={COPY.MAP_TITLE}>{COPY.LINK_MAP_UNAVAILABLE}</LinkNotice>;
  const { holder, read } = found;
  const { actor } = holder;
  const name = read.value.people.find((p) => p.id === actor.personId)?.name ?? '';
  return (
    <LinkMapPage
      mapId={mapId}
      initial={snapshotOf(read)}
      today={await ownerToday(holder.deps, holder.actor.userId)}
      actor={{ kind: 'link', personId: actor.personId, side: actor.side, name }}
      ownerName={holder.ownerName}
      ourName={holder.ourName}
      readOnly={read.record.stage === 'exit'}
    />
  );
}
