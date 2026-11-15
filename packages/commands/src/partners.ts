import {
  deleteSectionChanges, fillEmpty, MAX_BATCH, MOVES_STAGE, parsePartnerChange, parsePartnerChanges, type AccountFields, type PartnerBook, type PartnerChange,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { CreatedFile, Snapshot } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import { actorLabel, ownerOf, type Actor } from './actor';
import { dropMaps, mapsOf, refreshSummary, revokeMapAccess } from './map-shared';
import { moveDatesAfterSigning } from './maps';
import { casesOf, dropCases, revokeCaseLinks } from './shared';
import type { Deps } from './deps';
import { DuplicateEntry } from './directory';
import { checkPartnerPrograms } from './program-links';
import { createFailed, FORBIDDEN, fromStore, invalid, isOwner, NOT_FOUND_FILE, ok, record, touchedIds, type CommandResult } from './result';
import { ownCompanyOnly } from './own-company';
import { partnerWebhooks } from './webhooks';

const id = z.string().min(1).max(64);
/** The file holds other rows than the person saw: nothing is written, and the page offers Refresh. */
const CONFLICT = { ok: false as const, error: 'conflict' as const, message: COPY.SAVE_CONFLICT };
const companyId = z.string().regex(/^co_[0-9a-z]{10}$/);
const readInput = z.object({ companyId }).strict();
/** `shiftMapDates`: with a signing, also move the partner type's MAP's open dates (spec 5.3, ruling R4). */
const changeInput = z.object({ companyId, change: z.unknown(), shiftMapDates: z.boolean().optional() }).strict();
/** An import into one market, or (no market) a company and its partner type added by hand as one write. */
const importInput = z.object({ companyId, marketId: id.optional(), changes: z.unknown() }).strict();
/**
 * What happens to the business cases and the MAPs of what is removed (spec 5.5, 5.6): one question for both
 * [builder's call], asked only when there are some.
 */
const itemsChoice = z.enum(['trash', 'keep']).optional();
/** `expected`: the ids of the rows the person saw going (the partner type, its company's contacts, the company). */
const removeInput = z.object({ companyId, partnerId: id, expected: z.array(id).min(1).max(1000), items: itemsChoice }).strict();
const recreateInput = z.object({ companyId, items: itemsChoice }).strict();

/** Business cases or MAPs would be left behind: the person chooses first what happens to them. Nothing is written. */
const chooseForItems = (cases: number, maps: number) => ({
  ok: false as const, error: 'invalid' as const, message: COPY.ITEMS_CHOOSE(cases, maps), fieldErrors: { items: COPY.ITEMS_CHOOSE(cases, maps) },
});

/** The book with the company id the directory names: `_meta` (and the rows that take their id from it) can be edited by hand. */
function withCompany(snapshot: Snapshot<PartnerBook>, companyId: string): Snapshot<PartnerBook> {
  const book = snapshot.value;
  return { ...snapshot, value: { ...book, companyId, partners: book.partners.map((p) => ({ ...p, companyId })) } };
}

/** The market a market link change names, if it names one. */
function linkedMarket(change: PartnerChange): string | undefined {
  if (change.kind !== 'add' && change.kind !== 'update') return undefined;
  if (change.entity !== 'marketLink') return undefined;
  const given = change.kind === 'add' ? change.values.marketId : change.patch.marketId;
  return typeof given === 'string' ? given : undefined;
}

/** An account update: the only change an import may carry that is not an add. */
function isAccountUpdate(change: PartnerChange): change is Extract<PartnerChange, { kind: 'update' }> & { entity: 'account' } {
  return change.kind === 'update' && change.entity === 'account';
}

/** True when `patch` sets the same fields as `fill`, and no others. */
function sameFields(patch: Record<string, unknown>, fill: Partial<AccountFields>): boolean {
  const filled = Object.entries(fill);
  return Object.keys(patch).length === filled.length && filled.every(([key, value]) => patch[key] === value);
}

/** Reads the Partner book. The first read for a company makes the (empty) book, but only for its owner (`ownCompanyOnly`). */
export const readPartners = ownCompanyOnly(async function readPartners(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<Snapshot<PartnerBook>>> {
  const parsed = readInput.safeParse(input);
  if (!parsed.success) return invalid();
  let entry = await deps.directory.partnerBook(parsed.data.companyId);
  if (!entry) {
    // Nobody owns this company yet. Only a person makes its book, never an agent.
    if (actor.kind !== 'owner') return NOT_FOUND_FILE;
    let created: CreatedFile;
    try {
      created = await deps.partnerBooks.create(ownerOf(actor), parsed.data.companyId);
    } catch (error) {
      return createFailed(error);
    }
    try {
      await deps.directory.addPartnerBook({ companyId: parsed.data.companyId, ownerUserId: actor.userId, fileId: created.fileId });
      entry = { fileId: created.fileId, ownerUserId: actor.userId };
    } catch (error) {
      await deps.partnerBooks.discard({ fileId: created.fileId });
      if (!(error instanceof DuplicateEntry)) throw error;
      // A second first read won the race: read the winner's book, and ours is gone.
      entry = await deps.directory.partnerBook(parsed.data.companyId);
      if (!entry) throw error;
    }
  }
  if (!isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!can(actor, 'partners.read', entry)) return FORBIDDEN;
  const read = await deps.partnerBooks.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  await record(deps, actor, 'partners.read', entry.fileId, []);
  return ok(withCompany(read.snapshot, parsed.data.companyId));
});

/**
 * What the proposals commands write beside a person's change when they accept an agent's proposal (agent proposals spec
 * 7.3): the desk notes and the proposal's own rows, in the same write as the change, all or nothing. Never part of the
 * input: only those commands pass it, with changes core built from a checked proposal.
 */
export type BesideChanges = { with: PartnerChange[] };

/**
 * One change to the Partners file. With a signing and `shiftMapDates`, the partner type's MAP's open dates move too,
 * after the signing is saved: the signing stands whatever happens to the MAP, and `mapDates` says whether they moved.
 * `extra.with` go in the same write, after the change.
 */
export const changePartner = ownCompanyOnly(async function changePartner(
  deps: Deps, actor: Actor, input: unknown, extra?: BesideChanges,
): Promise<CommandResult<{ snapshot: Snapshot<PartnerBook>; entityId: string | null; mapDates?: { moved: boolean; days: number } }>> {
  const parsed = changeInput.safeParse(input);
  if (!parsed.success) return invalid();
  const change = parsePartnerChange(parsed.data.change);
  if (!change.ok) return invalid(change.fieldErrors);
  const shift = parsed.data.shiftMapDates === true;
  if (parsed.data.shiftMapDates !== undefined && change.change.kind !== 'markSigned') return invalid();
  const entry = await deps.directory.partnerBook(parsed.data.companyId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  const beside = extra?.with ?? [];
  if (![change.change, ...beside].every((c) => can(actor, 'partners.change', entry, c))) return FORBIDDEN;
  // A partner type with business cases goes only through Remove, which asks what happens to them (spec 5.5).
  if (change.change.kind === 'delete' && change.change.entity === 'partner') {
    if ((await casesOf(deps, actor, parsed.data.companyId, change.change.id)).length > 0) {
      return { ok: false, error: 'invalid', message: COPY.CASES_USE_REMOVE };
    }
    // The same for its MAP (spec 5.6).
    if ((await mapsOf(deps, actor, parsed.data.companyId, change.change.id)).length > 0) {
      return { ok: false, error: 'invalid', message: COPY.MAP_USE_REMOVE };
    }
  }
  // A link to a market must point at one of this company's markets that this person can read.
  const linked = linkedMarket(change.change);
  if (linked !== undefined) {
    const market = await deps.directory.market(linked);
    if (!market || market.companyId !== parsed.data.companyId || !isOwner(actor, market)) return NOT_FOUND_FILE;
    if (!can(actor, 'markets.read', market)) return FORBIDDEN;
  }
  // A program and level must fit the partner type: nothing is written otherwise.
  const program = await checkPartnerPrograms(deps, actor, parsed.data.companyId, entry, [change.change]);
  if (program) return program;
  const out = await applyOne(deps, entry.fileId, change.change, beside, actorLabel(actor));
  if (!out.ok) return fromStore(out);
  await record(deps, actor, 'partners.change', entry.fileId, touchedIds(change.change as { id?: string; partnerId?: string }, out.entityId), change.change.kind);
  // A signing, and every change that moves the stage (a signing too: recruitment to onboarding), goes to the person's
  // webhooks (spec 7.2), by ids only. Never fails the change.
  if (change.change.kind === 'markSigned') {
    await partnerWebhooks(deps, entry.ownerUserId, parsed.data.companyId, 'partner.signed', change.change.partnerId, out.snapshot.value);
  }
  if (MOVES_STAGE[change.change.kind] && 'partnerId' in change.change) {
    await partnerWebhooks(deps, entry.ownerUserId, parsed.data.companyId, 'partner.stage_changed', change.change.partnerId, out.snapshot.value);
  }
  // A reopen or an undone signing changes what the MAP joins in: its summary on the row is written again (best effort),
  // and the answer carries the file as it is then.
  if (change.change.kind === 'reopen' || change.change.kind === 'undoSigned') {
    if (await refreshSummary(deps, actor, parsed.data.companyId, change.change.partnerId)) {
      const fresh = await deps.partnerBooks.read({ fileId: entry.fileId });
      if (fresh.ok) return ok({ snapshot: withCompany(fresh.snapshot, parsed.data.companyId), entityId: out.entityId });
    }
  }
  if (shift && change.change.kind === 'markSigned') {
    const mapDates = await moveDatesAfterSigning(deps, actor, parsed.data.companyId, change.change.partnerId);
    if (mapDates) return ok({ snapshot: out.snapshot, entityId: out.entityId, mapDates });
  }
  return ok({ snapshot: out.snapshot, entityId: out.entityId });
});

/** The change alone (`apply`), or with the changes beside it in one write (`applyMany`): the change's own row id either way. */
async function applyOne(deps: Deps, fileId: string, change: PartnerChange, beside: PartnerChange[], actor: string) {
  const stamp = { now: deps.clock(), actor };
  if (beside.length === 0) return deps.partnerBooks.apply({ fileId }, change, stamp);
  const out = await deps.partnerBooks.applyMany({ fileId }, [change, ...beside], stamp);
  return out.ok ? { ok: true as const, snapshot: out.snapshot, entityId: out.entityIds[0] ?? null } : out;
}

/**
 * An import: all the changes in one write, or none. Adds, and an account update that only fills empty fields.
 * With a market, it must belong to this company and this person, and every link names it. Without one (a company and
 * its partner type added by hand, so they save together), the batch may not link to any market.
 */
export const importPartners = ownCompanyOnly(async function importPartners(
  deps: Deps, actor: Actor, input: unknown, extra?: BesideChanges,
): Promise<CommandResult<{ snapshot: Snapshot<PartnerBook>; entityIds: Array<string | null> }>> {
  const parsed = importInput.safeParse(input);
  if (!parsed.success) return invalid();
  // An accepted proposal's batch is built by core from a checked proposal of up to 50 companies, so it may hold more
  // than a pasted table's 100 changes: still one write. A batch from a screen or an agent keeps the cap.
  const changes = parsePartnerChanges(parsed.data.changes, extra ? Number.POSITIVE_INFINITY : MAX_BATCH);
  // As for a refusal at apply time: how many changes came before the one that couldn't be read.
  if (!changes.ok) return { ...invalid(changes.fieldErrors), ...(changes.valid !== undefined ? { valid: changes.valid } : {}) };
  // An import adds rows. An update it may carry fills empty fields on an account already in the book.
  // A partner update, a delete or a decision goes through changePartner.
  if (changes.changes.some((c) => c.kind !== 'add' && !isAccountUpdate(c))) return invalid();
  const { companyId: company, marketId } = parsed.data;
  // Every link in the batch points at the import's own market, and nothing else. With no market, no link at all.
  if (changes.changes.some((c) => { const m = linkedMarket(c); return m !== undefined && m !== marketId; })) return invalid();
  const entry = await deps.directory.partnerBook(company);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (marketId !== undefined) {
    const market = await deps.directory.market(marketId);
    if (!market || market.companyId !== company || !isOwner(actor, market)) return NOT_FOUND_FILE;
    if (!can(actor, 'markets.read', market)) return FORBIDDEN;
  }
  const beside = extra?.with ?? [];
  if (!changes.changes.every((change) => can(actor, 'partners.import', entry, change))) return FORBIDDEN;
  if (!beside.every((change) => can(actor, 'partners.change', entry, change))) return FORBIDDEN;
  const program = await checkPartnerPrograms(deps, actor, company, entry, changes.changes);
  if (program) return program;
  const updates = changes.changes.filter(isAccountUpdate);
  if (updates.length > 0) {
    const read = await deps.partnerBooks.read({ fileId: entry.fileId });
    if (!read.ok) return fromStore(read);
    for (const change of updates) {
      const account = read.snapshot.value.accounts.find((a) => a.id === change.id);
      // Missing, or a field the account already has: nothing is written.
      if (!account || !sameFields(change.patch, fillEmpty(account, change.patch as Partial<AccountFields>))) return invalid();
    }
  }
  const out = await deps.partnerBooks.applyMany({ fileId: entry.fileId }, [...changes.changes, ...beside], { now: deps.clock(), actor: actorLabel(actor) });
  if (!out.ok) return fromStore(out);
  // The ids of the import's own changes; the rows beside them are the proposal's, which its own event names.
  const entityIds = out.entityIds.slice(0, changes.changes.length);
  const touched = changes.changes.flatMap((c, i) => touchedIds(c as { id?: string; partnerId?: string }, entityIds[i] ?? null));
  await record(deps, actor, 'partners.import', entry.fileId, [...(marketId !== undefined ? [marketId] : []), ...touched]);
  return ok({ snapshot: out.snapshot, entityIds });
});

/**
 * Removes one partner type from its company, in one write: the partner type and, when it was the company's last one,
 * the company's contacts and the company (core's `deleteSectionChanges`, worked out on the file as it is now). Only
 * when that is exactly what the person saw going (`expected`): a contact added since, or one already gone, is a
 * conflict, and nothing is written. A decision: only a person removes a partner type, never an agent.
 */
export const removePartnerType = ownCompanyOnly(async function removePartnerType(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ snapshot: Snapshot<PartnerBook>; entityIds: Array<string | null> }>> {
  const parsed = removeInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { companyId: company, partnerId } = parsed.data;
  const entry = await deps.directory.partnerBook(company);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!can(actor, 'partners.remove', entry, { kind: 'delete', entity: 'partner', id: partnerId })) return FORBIDDEN;
  const cases = await casesOf(deps, actor, company, partnerId);
  const maps = await mapsOf(deps, actor, company, partnerId);
  // On a company server the files always go to the trash, so nothing is left where no one sees it (plan 13, task 9's
  // review). The person is still asked first: only an answer they gave becomes "trash" (task 12's review).
  const items = parsed.data.items === undefined ? undefined : deps.alwaysTrash ? 'trash' : parsed.data.items;
  if ((cases.length > 0 || maps.length > 0) && items === undefined) return chooseForItems(cases.length, maps.length);
  const read = await deps.partnerBooks.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const changes = deleteSectionChanges(read.snapshot.value, partnerId);
  const going = new Set(changes.flatMap((c) => ('id' in c ? [c.id] : [])));
  const seen = new Set(parsed.data.expected);
  if (going.size !== seen.size || [...going].some((rowId) => !seen.has(rowId))) return CONFLICT;
  // The links go off before the write: a write refused then leaves only the links off, and can be made again.
  await revokeCaseLinks(deps, actor, cases);
  await revokeMapAccess(deps, actor.userId, maps.map((m) => m.mapId));
  const out = await deps.partnerBooks.applyMany({ fileId: entry.fileId }, changes, { now: deps.clock(), actor: actorLabel(actor) });
  if (!out.ok) return fromStore(out);
  await record(deps, actor, 'partners.remove', entry.fileId, changes.flatMap((c) => touchedIds(c as { id?: string }, null)));
  // Only after the partner type is gone: a removal refused above leaves its cases' and MAP's rows and files as they were.
  await dropCases(deps, actor, cases, items ?? 'keep');
  await dropMaps(deps, actor, maps, items ?? 'keep');
  return ok({ snapshot: out.snapshot, entityIds: out.entityIds });
});

/**
 * Makes a new Partner book when the file is gone, or was made by an earlier version (that file goes to the trash).
 * A file that still reads is left as it is.
 */
export const recreatePartnerBook = ownCompanyOnly(async function recreatePartnerBook(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<Snapshot<PartnerBook>>> {
  const parsed = recreateInput.safeParse(input);
  if (!parsed.success) return invalid();
  const entry = await deps.directory.partnerBook(parsed.data.companyId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!can(actor, 'partners.recreate', entry)) return FORBIDDEN;
  const existing = await deps.partnerBooks.read({ fileId: entry.fileId });
  if (existing.ok) return ok(withCompany(existing.snapshot, parsed.data.companyId));
  // Only a file that is really gone, or one from an earlier version, is replaced. Any other trouble is passed on.
  if (existing.error !== 'file_not_found' && existing.error !== 'old_version') return fromStore(existing);
  const trashOld = existing.error === 'old_version';
  // A new file has none of the partner types the company's cases and MAPs are for (spec 5.5, 5.6): the person chooses first.
  const cases = await casesOf(deps, actor, parsed.data.companyId);
  const maps = await mapsOf(deps, actor, parsed.data.companyId);
  // On a company server the files always go to the trash, so nothing is left where no one sees it (plan 13, task 9's
  // review). The person is still asked first: only an answer they gave becomes "trash" (task 12's review).
  const items = parsed.data.items === undefined ? undefined : deps.alwaysTrash ? 'trash' : parsed.data.items;
  if ((cases.length > 0 || maps.length > 0) && items === undefined) return chooseForItems(cases.length, maps.length);
  // The links go off before the new file: a failure after that leaves only the links off, and can be made again.
  await revokeCaseLinks(deps, actor, cases);
  await revokeMapAccess(deps, actor.userId, maps.map((m) => m.mapId));
  let created: CreatedFile;
  try {
    created = await deps.partnerBooks.create(ownerOf(actor), parsed.data.companyId);
  } catch (error) {
    return createFailed(error);
  }
  let fileId = created.fileId;
  let won = false;
  try {
    await deps.directory.replacePartnerBook({ companyId: parsed.data.companyId, ownerUserId: actor.userId, oldFileId: entry.fileId, fileId });
    won = true;
  } catch (error) {
    await deps.partnerBooks.discard({ fileId: created.fileId });
    if (!(error instanceof DuplicateEntry)) throw error;
    // A second recreate won the race: read the winner's book, and ours is gone.
    const winner = await deps.directory.partnerBook(parsed.data.companyId);
    if (!winner || !isOwner(actor, winner)) throw error;
    fileId = winner.fileId;
  }
  // After the try: a failing event sink must never throw away the book the directory now names.
  // The old file is trashed only after the directory points at the new one, and still if the event then throws.
  if (won) {
    if (trashOld) await deps.partnerBooks.trash({ fileId: entry.fileId });
    await record(deps, actor, 'partners.recreate', fileId, []);
    await dropCases(deps, actor, cases, items ?? 'keep');
    await dropMaps(deps, actor, maps, items ?? 'keep');
  }
  const read = await deps.partnerBooks.read({ fileId });
  return read.ok ? ok(withCompany(read.snapshot, parsed.data.companyId)) : fromStore(read);
});
