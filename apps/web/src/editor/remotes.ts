import type { ClosedAs, IsoDate, Market, MarketChange, PartnerBook, PartnerChange } from '@partner-desk/core';
import { type FourC } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { startTransition } from 'react';
import { marketChange, marketExclusionsImport } from '@/app/(signed-in)/actions/markets';
import { partnerChange, partnerImport, partnerRemoveType, type MapDatesMoved } from '@/app/(signed-in)/actions/partners';
import { proposalAccept, proposalReject } from '@/app/(signed-in)/actions/proposals';
import type { EditorRemote, RemoteBatchResult, RemoteFailure } from './remote';

/** Runs a server action inside a transition, so Next keeps the page responsive while it saves. */
export function inTransition<T>(action: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    startTransition(async () => {
      try {
        resolve(await action());
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * A batch of Partner book changes, saved in one write: adds into one market (an import), adds with no market (a
 * company and its partner type added by hand), or removing a partner type (`remove`: core's `deleteSectionChanges`).
 * A removal's changes show on screen and give the undo; the server works out the same ones from the file as it is now
 * and removes them only when they are the ones sent. `items`: what happens to the partner type's business cases and its
 * MAP, when it has some (spec 5.5, 5.6): to the Drive trash, or kept in Drive.
 * `accept` and `reject` answer an agent's proposal (agent proposals spec 10.3): the changes are what the answer does on
 * screen at once; the server works the answer out from the file as it is now, by the proposal's id.
 */
export type PartnerBatch =
  | { marketId?: string; remove?: undefined; sign?: undefined; accept?: undefined; reject?: undefined }
  | { remove: true; marketId?: undefined; sign?: undefined; accept?: undefined; reject?: undefined; items?: 'trash' | 'keep' }
  | { sign: SignWithMapDates; marketId?: undefined; remove?: undefined; accept?: undefined; reject?: undefined }
  | { accept: AcceptBatch; marketId?: undefined; remove?: undefined; sign?: undefined; reject?: undefined }
  | { reject: RejectBatch; marketId?: undefined; remove?: undefined; sign?: undefined; accept?: undefined };

/** What a refused answer to a proposal hears, besides the editor: its code, so the page can say why and read again. */
type OnRefused = (failure: RemoteFailure) => void;

/**
 * Accepting a proposal: the card's `updatedAt` (`ProposalView.targetUpdatedAt`), the letters ticked ("Accept some")
 * with the note for the others, the close or sign dialog's values. With `sign`, the signing moves the MAP's open
 * dates too (`shiftMapDates`).
 */
export interface AcceptBatch {
  proposalId: string;
  expectedUpdatedAt?: string | null;
  letters?: FourC[];
  ticked?: number[];
  signedDate?: IsoDate;
  as?: ClosedAs;
  reason?: string;
  note?: string;
  sign?: SignWithMapDates;
  onRefused?: OnRefused;
}

/** Rejecting a proposal, with the person's "Why not?". */
export interface RejectBatch { proposalId: string; note?: string; onRefused?: OnRefused }

/**
 * A signing that also moves the partner type's MAP's open dates (spec 5.3, ruling R4): one change, sent with
 * `shiftMapDates`. `onMapDates` hears whether the dates moved once the signing is saved; the signing stands either way.
 */
export interface SignWithMapDates {
  onMapDates?: (moved: MapDatesMoved | null) => void;
}

/** The partner type a removal batch deletes: its first change. The editor has put in the saved ids by now. */
function removedPartnerId(changes: PartnerChange[]): string | undefined {
  const first = changes[0];
  return first?.kind === 'delete' && first.entity === 'partner' ? first.id : undefined;
}

/** The rows the person saw going: the server removes exactly these, or nothing (a conflict). */
const removedIds = (changes: PartnerChange[]): string[] => changes.flatMap((c) => (c.kind === 'delete' ? [c.id] : []));

/** Saves Partner book changes through the server actions. Module-level, so it is referentially stable. */
export const partnersRemote: EditorRemote<PartnerBook, PartnerChange, PartnerBatch> = {
  apply: (change) => inTransition(() => partnerChange(change)),
  applyMany: (changes, batch) => inTransition(async () => {
    if (batch.accept) return accepting(changes, batch.accept);
    if (batch.reject) return rejecting(batch.reject);
    if (batch.sign) return signMovingDates(changes, batch.sign);
    return batch.remove
      ? partnerRemoveType({
        partnerId: removedPartnerId(changes), expected: removedIds(changes), ...(batch.items ? { items: batch.items } : {}),
      })
      : partnerImport({ ...(batch.marketId !== undefined ? { marketId: batch.marketId } : {}), changes });
  }),
};

/** The signing alone, with `shiftMapDates`, answered as a batch of one. */
async function signMovingDates(changes: PartnerChange[], sign: SignWithMapDates): Promise<RemoteBatchResult<PartnerBook>> {
  const [change] = changes;
  if (changes.length !== 1 || change?.kind !== 'markSigned') throw new Error('A signing that moves the MAP’s dates is one signing');
  const result = await partnerChange(change, { shiftMapDates: true });
  if (!result.ok) return result;
  sign.onMapDates?.(result.mapDates ?? null);
  return { ok: true, snapshot: result.snapshot, entityIds: [result.entityId] };
}

/**
 * The rows the server made for what the page added on screen: a 4C accept on a partner type with no Qualification row
 * adds one, and the file's row of that partner type is it. Its id goes at the add's place, so a desk note edited right
 * after is sent to the saved row, not the one on screen. Every other change made no row.
 */
function madeRows(changes: PartnerChange[], book: PartnerBook): Array<string | null> {
  return changes.map((change) => {
    if (change.kind !== 'add' || change.entity !== 'qualification') return null;
    const partnerId = (change.values as { partnerId?: unknown }).partnerId;
    return book.qualifications.find((q) => q.partnerId === partnerId)?.id ?? null;
  });
}

/** An accept, by the proposal's id: the server's answer replaces what the page showed at once. */
async function accepting(changes: PartnerChange[], { sign, onRefused, ...input }: AcceptBatch): Promise<RemoteBatchResult<PartnerBook>> {
  const result = await proposalAccept({ ...input, ...(sign ? { shiftMapDates: true } : {}) });
  if (!result.ok) {
    onRefused?.(result);
    return result;
  }
  sign?.onMapDates?.(result.mapDates ?? null);
  return { ok: true, snapshot: result.snapshot, entityIds: madeRows(changes, result.snapshot.value) };
}

/** A rejection, answered as a batch. */
async function rejecting({ onRefused, ...input }: RejectBatch): Promise<RemoteBatchResult<PartnerBook>> {
  const result = await proposalReject(input);
  if (!result.ok) {
    onRefused?.(result);
    return result;
  }
  return { ok: true, snapshot: result.snapshot, entityIds: [] };
}

/**
 * A batch of market changes: Exclusions taken from another market (none), or `accept`, an agent's proposal of a
 * hypothesis's or the market's status (agent proposals spec 10.3). The change is what the accept does on screen at
 * once; the server works it out again from the file by the proposal's id (spec 7.3: the market, then its rows).
 */
export type MarketBatch = { accept?: MarketAcceptBatch } | undefined;

/**
 * Accepting a market kind: the card's `updatedAt` when the page read the market. `onBook` gets the Partner book as
 * the answer wrote it (the proposal's rows), for the page's other editor; `onRefused` the refusal's code.
 */
export interface MarketAcceptBatch {
  proposalId: string;
  expectedUpdatedAt?: string | null;
  onBook?: (book: Snapshot<PartnerBook>) => void;
  onRefused?: OnRefused;
}

/** A market kind's accept, answered as the market's batch: the market as written. */
async function acceptingMarket({ onBook, onRefused, ...input }: MarketAcceptBatch): Promise<RemoteBatchResult<Market>> {
  const result = await proposalAccept(input);
  if (result.ok && result.market) {
    onBook?.(result.snapshot);
    return { ok: true, snapshot: result.market, entityIds: [] };
  }
  // A market kind's answer always holds the market; without one there is nothing to show.
  const failure: RemoteFailure = result.ok ? { ok: false, error: 'invalid', message: COPY.GONE } : result;
  onRefused?.(failure);
  return failure;
}

/**
 * Saves one market's changes through the server actions; a batch is Exclusions taken from another market, or an
 * accepted proposal. Make it once per market (useMemo on the id).
 */
export function marketRemote(marketId: string): EditorRemote<Market, MarketChange, MarketBatch> {
  return {
    apply: (change) => inTransition(() => marketChange(marketId, change)),
    applyMany: (changes, batch) => inTransition(() => (batch?.accept ? acceptingMarket(batch.accept) : marketExclusionsImport(marketId, changes))),
  };
}
