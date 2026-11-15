'use server';

import { changePartner, importPartners, invalid, recreatePartnerBook, removePartnerType } from '@partner-desk/commands';
import type { PartnerBook } from '@partner-desk/core';
import { z } from 'zod';
import type { RemoteBatchResult, RemoteResult } from '@/editor/remote';
import { asOwner, batched, changed, read, refused } from './context';

// Every action works on the signed-in person's own Partner book. The company id comes from the session only.

const signOptions = z.object({ shiftMapDates: z.boolean() }).strict();

/** Whether a signing moved the partner type's MAP's open dates (spec 5.3), when the signing asked for it. */
export type MapDatesMoved = { moved: boolean; days: number };

/**
 * One change to the Partner book: an add, an edit, a delete, a step or stage move, closing, signing, the exit, undoing
 * a signing or correcting an exit. With a signing, `options.shiftMapDates` moves the MAP's open dates too, after the
 * signing is saved; `mapDates` says whether they moved.
 */
export async function partnerChange(change: unknown, options?: unknown): Promise<RemoteResult<PartnerBook> & { mapDates?: MapDatesMoved }> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = signOptions.optional().safeParse(options);
    if (!parsed.success) return refused(invalid());
    const shift = parsed.data?.shiftMapDates;
    const out = await changePartner(deps, actor, { companyId: await companyId(), change, ...(shift !== undefined ? { shiftMapDates: shift } : {}) });
    const result = changed(out);
    return out.ok && out.value.mapDates ? { ...result, mapDates: out.value.mapDates } : result;
  });
}

/**
 * An import into one market, or with no market a company and its partner type added by hand: adds, including an
 * account, and an account update that only fills empty fields, up to MAX_BATCH (100), all or nothing. The command
 * checks that; this action does not. No company id may come with it.
 */
const importInput = z.object({ marketId: z.unknown().optional(), changes: z.unknown() }).strict();

export async function partnerImport(input: unknown): Promise<RemoteBatchResult<PartnerBook>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = importInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const { marketId, changes } = parsed.data;
    return batched(await importPartners(deps, actor, { companyId: await companyId(), ...(marketId !== undefined ? { marketId } : {}), changes }));
  });
}

/**
 * Removes one partner type, and with the company's last one the company and its contacts, in one write. The command
 * works out what goes from the file as it is now, and writes it only when it is `expected`, the rows the person saw going.
 * `items` (`trash` or `keep`) says what happens to its business cases and its MAP; refused with `fieldErrors.items`
 * when it has some and no choice came (spec 5.5, 5.6).
 */
const removeInput = z.object({ partnerId: z.unknown(), expected: z.unknown(), items: z.unknown().optional() }).strict();

export async function partnerRemoveType(input: unknown): Promise<RemoteBatchResult<PartnerBook>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = removeInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const { partnerId, expected, items } = parsed.data;
    return batched(await removePartnerType(deps, actor, { companyId: await companyId(), partnerId, expected, ...(items !== undefined ? { items } : {}) }));
  });
}

const recreateInput = z.object({ items: z.unknown().optional() }).strict();

/**
 * A new Partner book for one whose file is gone. Nothing happens while the old file still reads. `items` (`trash` or
 * `keep`) says what happens to the company's business cases and MAPs; refused with `fieldErrors.items` when there are
 * some and no choice came (spec 5.5, 5.6).
 */
export async function recreatePartners(input?: unknown): Promise<RemoteResult<PartnerBook>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = recreateInput.safeParse(input ?? {});
    if (!parsed.success) return refused(invalid());
    const { items } = parsed.data;
    return read(await recreatePartnerBook(deps, actor, { companyId: await companyId(), ...(items !== undefined ? { items } : {}) }));
  });
}
