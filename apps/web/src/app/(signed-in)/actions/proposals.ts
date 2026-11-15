'use server';

import { acceptProposal, invalid, rejectProposal } from '@partner-desk/commands';
import type { Market, PartnerBook } from '@partner-desk/core';
import type { Snapshot } from '@partner-desk/storage';
import { z } from 'zod';
import type { RemoteBatchResult, RemoteResult } from '@/editor/remote';
import { asOwner, refused } from './context';
import type { MapDatesMoved } from './partners';

// The person's answer to an agent's proposal (agent proposals spec 10.3), on the signed-in person's own Partner book:
// the company id comes from the session only. The commands check everything else.

/** What the page may send with an accept: the card's choices and the dialog's values. No company id. */
const acceptInput = z.object({
  proposalId: z.unknown(), expectedUpdatedAt: z.unknown().optional(), letters: z.unknown().optional(), ticked: z.unknown().optional(),
  signedDate: z.unknown().optional(), as: z.unknown().optional(), reason: z.unknown().optional(), note: z.unknown().optional(),
  shiftMapDates: z.unknown().optional(),
}).strict();
const rejectInput = z.object({ proposalId: z.unknown(), note: z.unknown().optional() }).strict();

/** Only the keys the page sent: a key with nothing in it isn't passed on. */
const given = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));

/**
 * Accepts a proposal, all of it or some, with the dialog's values: the Partners file as written (and the market for a
 * market kind), the proposal's status and, for a signing, whether the MAP's open dates moved. Answered as a batch, so
 * the page's editor takes it like any save; an accept makes no row the page added, so `entityIds` is empty.
 */
export async function proposalAccept(input: unknown): Promise<
  RemoteBatchResult<PartnerBook> & { market?: Snapshot<Market>; status?: string; mapDates?: MapDatesMoved }
> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = acceptInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const out = await acceptProposal(deps, actor, { ...given(parsed.data), companyId: await companyId() });
    if (!out.ok) return refused(out);
    const { status, book, market, mapDates } = out.value;
    return { ok: true, snapshot: book, entityIds: [], status, ...(market ? { market } : {}), ...(mapDates ? { mapDates } : {}) };
  });
}

/** Rejects a proposal with the person's optional note: the Partners file as written. */
export async function proposalReject(input: unknown): Promise<RemoteResult<PartnerBook>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = rejectInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const out = await rejectProposal(deps, actor, { ...given(parsed.data), companyId: await companyId() });
    return out.ok ? { ok: true, snapshot: out.value.book, entityId: null } : refused(out);
  });
}
