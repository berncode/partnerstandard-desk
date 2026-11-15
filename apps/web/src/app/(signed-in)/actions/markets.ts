'use server';

import { archiveMarket, changeMarket, copyMarket, createMarket, importExclusions, invalid, readMarket } from '@partner-desk/commands';
import type { Market } from '@partner-desk/core';
import { z } from 'zod';
import type { RemoteBatchResult, RemoteOutcome, RemoteResult } from '@/editor/remote';
import { asOwner, batched, changed, done, made, read, refused } from './context';

// Every action works on the signed-in person's own markets: the commands refuse a market of anyone else.

export async function marketRead(marketId: unknown): Promise<RemoteResult<Market>> {
  return asOwner(async ({ deps, actor }) => {
    const market = await readMarket(deps, actor, { marketId });
    if (!market.ok) return read(market);
    // The snapshot only, as the page's loader sends it: the file's link is not part of it.
    const { value, issues } = market.value;
    return read({ ok: true, value: { value, issues } });
  });
}

/** One change to a market: its details, a value point, a partner hypothesis, an exclusion or a change row. */
export async function marketChange(marketId: unknown, change: unknown): Promise<RemoteResult<Market>> {
  return asOwner(async ({ deps, actor }) => changed(await changeMarket(deps, actor, { marketId, change })));
}

/** Exclusions taken from another market, in one write, all or nothing (only adds of exclusions). */
export async function marketExclusionsImport(marketId: unknown, changes: unknown): Promise<RemoteBatchResult<Market>> {
  return asOwner(async ({ deps, actor }) => batched(await importExclusions(deps, actor, { marketId, changes })));
}

/** A new market in the person's company: the answer's entity id is the new market's id. */
const createInput = z.object({ info: z.unknown() }).strict();

export async function marketCreate(input: unknown): Promise<RemoteResult<Market>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = createInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return made(await createMarket(deps, actor, { companyId: await companyId(), info: parsed.data.info }));
  });
}

/** A new market from another one (`{ marketId, info: { marketName, partnerType } }`): the entity id is the new market's. */
export async function marketCopy(input: unknown): Promise<RemoteResult<Market>> {
  return asOwner(async ({ deps, actor }) => made(await copyMarket(deps, actor, input)));
}

/** Archives a market, or brings it back. Works for a market whose file is gone. */
export async function marketArchive(marketId: unknown, archived: unknown): Promise<RemoteOutcome> {
  return asOwner(async ({ deps, actor }) => {
    const result = done(await archiveMarket(deps, actor, { marketId, archived }));
    return result.ok ? { ok: true } : result;
  });
}
