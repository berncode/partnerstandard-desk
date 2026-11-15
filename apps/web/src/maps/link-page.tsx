'use client';

// The MAP page for a person with a link: the same workspace gated by `canChangeMap` with their actor, saving through their
// own action. No Share, no sheet, no PartnerStandard Desk around it; a Sign out.
import type { IsoDate, MapActor, Side } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Lock, LogOut, Users } from 'lucide-react';
import { startTransition, useCallback } from 'react';
import { leaveMap, mapLinkChange } from '@/app/m/[mapId]/actions';
import { Button } from '@/ui/button';
import { PlanWorkspace } from './components/plan-workspace';
import { ourSideName, sideName } from './format';
import type { MapSnapshot, PlanRemote, RemoteResult } from './remote';

export const linkPresentPath = (mapId: string) => `/m/${mapId}/present`;

export function LinkMapPage({ mapId, initial, today, actor, ownerName, ourName, readOnly }: {
  mapId: string; initial: MapSnapshot; today: IsoDate; actor: Extract<MapActor, { kind: 'link' }>; ownerName: string; ourName: string;
  /** After the partner type's exit: the MAP stays readable, nothing changes (spec 5.3). */
  readOnly: boolean;
}) {
  const remote = useCallback<PlanRemote>(
    (change) => new Promise<RemoteResult>((resolve, reject) => {
      startTransition(async () => {
        try {
          resolve(await mapLinkChange({ mapId, change }));
        } catch (error) {
          reject(error);
        }
      });
    }),
    [mapId],
  );
  const ours = ourSideName(ourName, ownerName);
  return (
    <PlanWorkspace
      initial={initial} remote={remote} actor={actor} actorName={COPY.LINK_ACTOR(actor.name)} today={today} presentHref={linkPresentPath(mapId)}
      ourName={ourName} ownerName={ownerName} readOnly={readOnly}
      banner={(
        <>
          <LinkBanner mapId={mapId} name={actor.name} side={actor.side} ownerName={ownerName}
            sideName={sideName(actor.side, { ours, partner: initial.record.partnerName })} />
          {readOnly && (
            <div role="note" className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <p>{COPY.MAP_READ_ONLY_AFTER_EXIT}</p>
            </div>
          )}
        </>
      )}
    />
  );
}

/** Tells a link holder whose MAP this is and what they may change, with Sign out (spec 4). */
export function LinkBanner({ mapId, name, side, ownerName, sideName: theirSide }: {
  mapId: string; name: string; side: Side; ownerName: string; /** Their side by name. */ sideName: string;
}) {
  return (
    <div role="note" data-side={side} className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">
      <Users className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
      <p className="min-w-0 flex-1 basis-56 text-ink-2">
        <span className="font-medium text-ink">{COPY.MAP_LINK_SHARED_BY(ownerName)}</span>{' '}
        {COPY.MAP_LINK_EDITING_AS(name.trim() || COPY.MAP_LINK_SOMEONE, theirSide)}
      </p>
      <form action={leaveMap}>
        <input type="hidden" name="mapId" value={mapId} />
        <Button type="submit" size="sm" variant="ghost">
          <LogOut className="h-4 w-4" aria-hidden />
          {COPY.SIGN_OUT}
        </Button>
      </form>
    </div>
  );
}
