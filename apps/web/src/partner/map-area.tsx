'use client';

// The Mutual Action Plan area of a partner type's tab (spec 5.1, 5.4), in place of the Recruitment app's MAP card. Its numbers are the Plans page's card's.
import type { Partner, PartnerChange } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Map as MapIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { RemoteOutcome } from '@/editor/remote';
import { HealthBadge, NotSignedBadge } from '@/maps/badges';
import { DeleteMap, type DeleteMapAction } from '@/maps/delete-map';
import { formatMapDate } from '@/maps/format';
import { mapPath, PlanStats } from '@/maps/plan-card';
import { horizonLeft, type MapAreaState } from '@/maps/view-model';
import { formatDate, mapHealthOf } from '@/partners/partners-model';
import { Button, buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Section } from '@/ui/pieces';
import { sayIfRefused, usePartner } from './partner-context';

export type LoadMapArea = (input: { partnerId: string }) => Promise<RemoteOutcome<{ state: MapAreaState }>>;
export type StartMap = (input: { partnerId: string }) => Promise<RemoteOutcome<{ mapId: string }>>;
/**
 * Mark signed with "move the MAP's open dates" (spec 5.3, ruling R4): the signing, saved with the move after it.
 * Answers the local outcome at once, as `dispatch` does.
 */
export type SignMovingDates = (change: Extract<PartnerChange, { kind: 'markSigned' }>) =>
  { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string> };

/** The open partner type's MAP as the page has it. */
export type MapRead = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; state: MapAreaState };

interface MapAreaValue {
  map: MapRead;
  /** Starts the MAP and opens its guided steps (spec 5.2). */
  start: () => void;
  starting: boolean;
  /** Deletes a MAP that can't be read (spec 8). Absent where the page can't (a test harness). */
  remove?: DeleteMapAction;
  /** Reads the MAP again: after a delete, the area offers Start the MAP. */
  reload: () => void;
  /** Absent where the page can't send the move (a test harness). */
  signMovingDates?: SignMovingDates;
}

const MapAreaContext = createContext<MapAreaValue | null>(null);

/** The open partner type's MAP, for the area, Mark signed and Proceed to MAP. Null outside a partner page. */
export function useMapArea(): MapAreaValue | null {
  return useContext(MapAreaContext);
}

/** Start the MAP is offered from the MAP step in Recruitment on, and on every later stage (spec 5.2). */
export const mayStartMap = (partner: Pick<Partner, 'step' | 'signedDate'>): boolean => partner.step === 'map' || partner.signedDate !== null;

/** The guided steps of a new MAP. */
export const startPath = (mapId: string) => `${mapPath(mapId)}/start`;

/**
 * Reads the open partner type's MAP when the tab opens, whenever the page shows again (Next keeps it, hidden, while the
 * person is on the MAP), and again once a change to its record that the MAP shows (signing, stage, closing, exit) is saved.
 */
export function MapAreaProvider({ load, start, remove, signMovingDates, settled = true, children }: {
  load: LoadMapArea; start: StartMap; remove?: DeleteMapAction; signMovingDates?: SignMovingDates;
  /** False while the page's changes are still saving: the MAP is read once they are saved (a signing, say). */
  settled?: boolean;
  children: ReactNode;
}) {
  const { partner } = usePartner();
  const { id: partnerId, signedDate, stage, closed, exitedDate } = partner;
  const router = useRouter();
  const [read, setRead] = useState<{ key: string; map: MapRead } | null>(null);
  // Bumped to read the MAP again (after a delete).
  const [version, setVersion] = useState(0);
  const key = [partnerId, signedDate, stage, closed, exitedDate, version].join('|');
  const map: MapRead = read?.key === key ? read.map : { status: 'loading' };
  const [pending, startPending] = useTransition();
  // Once started, nothing here may start another while the guided steps load (push doesn't wait).
  const started = useRef(false);
  const [finished, setFinished] = useState(false);
  useLayoutEffect(() => () => {
    started.current = false;
    setFinished(false);
  }, []);

  // A change the MAP shows (a signing, say) is on screen before it is saved: the MAP is read for it once the save is
  // through. Other saves change nothing here, so they read nothing.
  const wanted = settled ? key : (read?.key ?? null);
  useEffect(() => {
    if (wanted !== key) return;
    let live = true;
    const show = (next: MapRead) => { if (live) setRead({ key, map: next }); };
    load({ partnerId })
      .then((answer) => show(answer.ok ? { status: 'ready', state: answer.state } : { status: 'failed', message: answer.message }))
      .catch(() => show({ status: 'failed', message: COPY.ACTION_FAILED }));
    return () => { live = false; };
  }, [load, partnerId, key, wanted]);

  const begin = useCallback(() => startPending(async () => {
    if (started.current) return;
    let result: Awaited<ReturnType<StartMap>>;
    try {
      result = await start({ partnerId });
    } catch {
      result = { ok: false, error: 'unavailable', message: COPY.ACTION_FAILED };
    }
    if (!result.ok) {
      toast.error(result.fieldErrors?.partnerId ?? result.message);
      return;
    }
    started.current = true;
    setFinished(true);
    router.push(startPath(result.mapId));
  }), [start, partnerId, router]);

  return (
    <MapAreaContext.Provider value={{
      map, start: begin, starting: pending || finished, reload: () => setVersion((v) => v + 1),
      ...(remove ? { remove } : {}), ...(signMovingDates ? { signMovingDates } : {}),
    }}>
      {children}
    </MapAreaContext.Provider>
  );
}

/**
 * The Mutual Action Plan area (spec 5.1): the MAP's health, the current horizon and its days left, the next milestone,
 * overdue activities and Open the MAP; without one, Start the MAP from the MAP step on. The yes/no stays a person's
 * answer (spec 5.4). The old "MAP link" field and the link to the MAP app are gone (owner, 2026-10-31): the Partner
 * record and the Partners tab keep the link as it is, unshown. It shows from the MAP step on, after signing, and
 * whenever the partner type has a MAP.
 */
export function MapArea() {
  const { partner, readOnly } = usePartner();
  const area = useMapArea();
  if (!area) return null;
  const { map, start, starting } = area;
  const state = map.status === 'ready' ? map.state : null;
  const hasMap = state !== null && state.kind !== 'none';
  if (!mayStartMap(partner) && !hasMap) return null;
  const canStart = !readOnly && state?.kind === 'none';

  return (
    <Section title={COPY.MAP_TITLE} description={COPY.MAP_TEXT}
      actions={canStart ? (
        <Button variant="primary" size="sm" disabled={starting} aria-busy={starting || undefined} onClick={start}>
          <MapIcon className="h-4 w-4" aria-hidden />
          {COPY.START_MAP}
        </Button>
      ) : undefined}>
      <div className="grid gap-4">
        {map.status === 'loading' && <p aria-busy="true" className="text-sm text-ink-3">{COPY.MAP_AREA_LOADING}</p>}
        {map.status === 'failed' && <p role="alert" className="text-sm text-danger">{map.message}</p>}
        {state?.kind === 'none' && <p className="text-sm text-ink-3">{COPY.MAP_AREA_EMPTY}</p>}
        {state?.kind === 'ready' && <MapSummary state={state} />}
        {state?.kind === 'unread' && <KeptSummary state={state} />}
        <MapQuestion />
        {partner.signedDate !== null && (
          <p className="border-t border-line pt-4 text-sm font-medium">
            {formatDate(partner.signedDate) ? COPY.SIGNED_ON(formatDate(partner.signedDate)) : COPY.SIGNED_ON_UNKNOWN}
          </p>
        )}
      </div>
    </Section>
  );
}

function OpenMap({ mapId }: { mapId: string }) {
  return <Link href={mapPath(mapId)} className={cn(buttonVariants({ size: 'sm' }), 'w-fit')}>{COPY.OPEN_MAP}</Link>;
}

/** The MAP as read now: health, the horizon and its days left, then the Plans page card's three numbers. */
function MapSummary({ state }: { state: Extract<MapAreaState, { kind: 'ready' }> }) {
  const { card, today } = state;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {card.health === null ? <NotSignedBadge /> : <HealthBadge health={card.health} />}
        <p className="min-w-0 text-sm text-ink-2">{horizonLeft(card.progress)}</p>
        <div className="ml-auto"><OpenMap mapId={state.mapId} /></div>
      </div>
      <PlanStats card={card} today={today} />
    </div>
  );
}

/**
 * A MAP that couldn't be read: what the partner record last kept of it, and why, with Open the MAP and Delete (spec 8).
 * Once deleted, the area reads again and offers Start the MAP.
 */
function KeptSummary({ state }: { state: Extract<MapAreaState, { kind: 'unread' }> }) {
  const { partner, readOnly } = usePartner();
  const area = useMapArea();
  const remove = !readOnly && state.deletable ? area?.remove : undefined;
  // As the Partners list says it: "Not signed" once the partner type was closed before signing (ruling R6). A row
  // with no health shows no badge: the MAP may be empty, or its summary not written yet (a failed best-effort write,
  // a reopen), and it can't be read to tell.
  const health = mapHealthOf({ closed: partner.closed, signedDate: partner.signedDate, mapHealth: state.health });
  return (
    <div className="grid gap-2">
      <p role="alert" className="text-sm text-warn">{state.message}</p>
      {(health !== 'none' || state.nextMilestone) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
          <span className="text-ink-3">{COPY.MAP_AREA_KEPT}</span>
          {health === 'not_signed' ? <NotSignedBadge /> : health !== 'none' && <HealthBadge health={health} />}
          {health !== 'not_signed' && state.nextMilestone && <span>{COPY.MAP_NEXT_ON(formatMapDate(state.nextMilestone, state.today))}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <OpenMap mapId={state.mapId} />
        {remove && <DeleteMap mapId={state.mapId} name={state.displayName} remove={remove} onDeleted={area!.reload} size="sm" />}
      </div>
    </div>
  );
}

/** "Is the Mutual Action Plan filled in and agreed with the partner?": a person's answer, feeding the sign nudge. */
function MapQuestion() {
  const { partner, dispatch, readOnly } = usePartner();
  const questionId = useId();
  const update = (patch: Partial<Partner>) =>
    dispatch({ kind: 'update', entity: 'partner', id: partner.id, patch }, { label: COPY.MAP_UPDATED });
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-sm font-medium">{COPY.MAP_QUESTION}</legend>
      <div className="flex gap-4">
        {([true, false] as const).map((filled) => (
          <label key={String(filled)} className="inline-flex items-center gap-1.5 text-sm">
            <input type="radio" name={`${questionId}-filled`} checked={partner.mapFilled === filled} disabled={readOnly}
              onChange={() => sayIfRefused(update({ mapFilled: filled }))} className="h-4 w-4 accent-brand-strong" />
            {filled ? COPY.YES : COPY.NO}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
