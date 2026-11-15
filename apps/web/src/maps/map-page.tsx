'use client';

// The owner's MAP page, saving each change through the `mapChange` server action, with Share next to Present.
import type { IsoDate, MapActor } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { CalendarClock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  mapChange, mapDelete, mapNotifyLoad, mapNotifySave, mapShareCopy, mapShareLoad, mapShareRevoke, mapShareSend, mapShiftDates,
} from '@/app/(signed-in)/actions/maps';
import { Button } from '@/ui/button';
import { PlanWorkspace } from './components/plan-workspace';
import { DeleteMap } from './delete-map';
import { NotificationsButton } from './notifications/notifications-dialog';
import type { NotificationActions } from './notifications/notification-types';
import { ourSideName, sideName } from './format';
import { mapPath } from './plan-card';
import { reviewPath } from '@/reviews/review-model';
import { ShareButton } from './share/share-dialog';
import type { ShareActions } from './share/share-types';
import type { MapSnapshot, PlanRemote, RemoteResult } from './remote';
import type { StorageKind } from '@/storage-kind';
import { useViewer } from '@/storage-context';

const OWNER: MapActor = { kind: 'owner' };

export const presentPath = (mapId: string) => `/plans/${mapId}/present`;

export function MapPage({ mapId, name, initial, today, actorName, fileUrl, ourName, ownerName, back, deletedTo, datesMove, storage }: {
  mapId: string;
  /** "Acme as reseller", as Delete names it. */
  name: string;
  initial: MapSnapshot; today: IsoDate; actorName: string; fileUrl: string | null; ourName: string; ownerName: string;
  /** The link back to the partner (or to Plans). */
  back: ReactNode;
  /** Where Delete goes once the MAP is gone: the partner's page, which offers Start the MAP again (or Plans). */
  deletedTo: string;
  /** The move of the open dates at signing failed: by how many days they would move now (ruling R4). */
  datesMove: { days: number } | null;
  /** Where the owner's files are: a Google account gets the Reconnect Google button, a test account none. */
  storage: StorageKind;
}) {
  // A link from This week opens at one activity (#activity-{id}). The row only exists once this page has rendered, which
  // can be after the browser looked for the hash, so scroll to it here.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id.startsWith('activity-')) return;
    document.getElementById(id)?.scrollIntoView({ block: 'center' });
  }, []);
  const remote = useCallback<PlanRemote>(
    (change) => new Promise<RemoteResult>((resolve, reject) => {
      startTransition(async () => {
        try {
          resolve(await mapChange({ mapId, change }));
        } catch (error) {
          reject(error);
        }
      });
    }),
    [mapId],
  );
  // A company server's viewer can't share, set the emails, delete or move dates: no button for it (owner, 2026-11-14).
  const viewer = useViewer();
  const share = useMemo(() => {
    const ours = ourSideName(ourName, ownerName);
    return shareActions(ours, sideName('partner', { ours, partner: initial.record.partnerName }));
  }, [ourName, ownerName, initial.record.partnerName]);
  return (
    <PlanWorkspace
      initial={initial} remote={remote} actor={OWNER} actorName={actorName} today={today} fileUrl={fileUrl}
      presentHref={presentPath(mapId)} reviewHref={reviewPath(mapId)} ourName={ourName} ownerName={ownerName}
      reconnect={{ next: mapPath(mapId), storage }}
      headerActions={viewer ? undefined : (
        <>
          <ShareButton mapId={mapId} actions={share} />
          <NotificationsButton mapId={mapId} actions={NOTIFY} />
          <DeleteMap mapId={mapId} name={name} remove={mapDelete} goTo={deletedTo} />
        </>
      )}
      banner={(
        <>
          {back}
          {datesMove && <DatesMoveNote mapId={mapId} days={datesMove.days} />}
        </>
      )}
    />
  );
}

/** The Notifications dialog's server actions. */
const NOTIFY: NotificationActions = {
  async load(mapId) {
    const out = await mapNotifyLoad({ mapId });
    return out.ok ? { ok: true, settings: out.settings } : { ok: false, message: out.message };
  },
  async save(mapId, settings) {
    const out = await mapNotifySave({ mapId, settings });
    return out.ok ? { ok: true, message: out.message } : { ok: false, message: out.message };
  },
};

/** The Share dialog's server actions, with both sides named as the page names them. */
function shareActions(ourName: string, partnerName: string): ShareActions {
  return {
    async load(mapId) {
      const out = await mapShareLoad({ mapId });
      return out.ok ? { ok: true, people: out.people, mailConfigured: out.mailConfigured, ourName, partnerName } : { ok: false, message: out.message };
    },
    async copy(mapId, personId) {
      const out = await mapShareCopy({ mapId, personId });
      return out.ok ? { ok: true, url: out.url } : { ok: false, message: out.message };
    },
    async send(mapId, personId) {
      const out = await mapShareSend({ mapId, personId });
      return out.ok ? { ok: true, message: out.message } : { ok: false, message: out.message };
    },
    async revoke(mapId, personId) {
      const out = await mapShareRevoke({ mapId, personId });
      return out.ok ? { ok: true, message: out.message } : { ok: false, message: out.message };
    },
  };
}

/**
 * When moving the open dates at signing failed (spec 5.3, ruling R4): says so, and offers the move again (not to a viewer). After it
 * worked the note goes and the page reads the MAP again, with its new dates.
 */
export function DatesMoveNote({ mapId, days }: { mapId: string; days: number }) {
  const router = useRouter();
  // A company server's viewer reads the note, with no button: they can't move the dates (owner, 2026-11-14).
  const viewer = useViewer();
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' } | { kind: 'failed'; message: string }>({ kind: 'idle' });
  if (state.kind === 'done') return null;
  const move = async () => {
    setState({ kind: 'busy' });
    const out = await mapShiftDates({ mapId });
    if (!out.ok) {
      setState({ kind: 'failed', message: out.message });
      return;
    }
    setState({ kind: 'done' });
    router.refresh();
  };
  return (
    <div role="note" className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 basis-56">{COPY.MAP_DATES_MOVE_FAILED}</p>
      {!viewer && <Button size="sm" variant="primary" disabled={state.kind === 'busy'} onClick={() => void move()}>{COPY.MAP_MOVE_OPEN_DATES(days)}</Button>}
      {state.kind === 'failed' && <p role="alert" className="basis-full text-danger">{state.message}</p>}
    </div>
  );
}
