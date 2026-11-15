// The trash on a company server (plan 16): what a person deleted, kept whole, that an admin brings back.
import { localTime, type PartnerBook, type Side } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { TrashedContent, TrashKind } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import type { Actor } from './actor';
import type { Deps } from './deps';
import { DuplicateEntry } from './directory';
import { emailHash, newMapLinkId } from './map-links';
import { hashToken, newToken } from './share-tokens';
import { MAX_NAME, ownerTimeZone, refreshSummary } from './map-shared';
import { displayNameOf } from './maps';
import { companyOf } from './own-company';
import { FORBIDDEN, fromStore, invalid, ok, record, type CommandResult, type Failure } from './result';
import { logQuietly, refused } from './shared';

/** One trashed file, with what its body says it is; `content` is null when the body can't be read. */
export interface TrashedFile {
  fileId: string;
  kind: TrashKind;
  trashedAt: string;
  /** When the file was made: a restored MAP's created time (its body doesn't hold one). */
  createdAt: string;
  /** The id the item had when it was deleted (its delete's event): a MAP comes back under it, with its links still off. */
  formerId: string;
  content: TrashedContent | null;
}

/** A company's trash. `@partner-desk/platform` has the database's; only a company server has one. */
export interface Trash {
  /**
   * The company's cases, MAPs and programs a person deleted, the latest first. A file trashed when a create failed was
   * never listed, so it isn't here either.
   */
  list(companyId: string): Promise<TrashedFile[]>;
  /** One of them, if it is the company's and still in the trash. */
  get(companyId: string, fileId: string): Promise<TrashedFile | null>;
  /**
   * Takes the file out of the trash, if it is still there as `trashedAt` says: true for the one restore that does it,
   * false for a second one at the same time.
   */
  restore(fileId: string, trashedAt: string): Promise<boolean>;
  /** Puts it back, when its restore couldn't be finished. */
  trash(fileId: string, at: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------
// The commands (plan 16, task 2)

/** One item as Settings, Trash lists it: its kind, its name, when it was deleted, and why it can't come back, if so. */
export interface TrashItem {
  fileId: string;
  kind: TrashKind;
  name: string;
  deletedAt: string;
  /** Null when it can come back; else the reason, in words. */
  blocked: string | null;
}

const nothing = z.object({}).strict();
const restoreInput = z.object({ fileId: z.string().min(1).max(64) }).strict();
const GONE: Failure = { ok: false, error: 'not_found', message: COPY.TRASH_GONE };

/** The company's Partners as read now: null when the company has none; a failure when it can't be read now. */
async function partnersOf(deps: Deps, company: string): Promise<{ ok: true; book: PartnerBook | null } | Failure> {
  const entry = await deps.directory.partnerBook(company);
  if (!entry) return { ok: true, book: null };
  const read = await deps.partnerBooks.read({ fileId: entry.fileId });
  return read.ok ? { ok: true, book: read.snapshot.value } : fromStore(read);
}

const partnerName = (book: PartnerBook | null, partnerId: string): string => {
  const partner = book?.partners.find((p) => p.id === partnerId);
  return (book?.accounts.find((a) => a.id === partner?.accountId)?.company ?? '').trim().slice(0, MAX_NAME).trim();
};

/** Why this item can't come back now, or null. `book` is null when the company has no Partners file. */
async function blockedBy(deps: Deps, company: string, book: PartnerBook | null, file: TrashedFile): Promise<string | null> {
  const content = file.content;
  if (!content) return COPY.TRASH_UNREADABLE;
  if (content.kind === 'program') return null;
  if (!book?.partners.some((p) => p.id === content.partnerId)) return COPY.MAP_TYPE_GONE;
  if (content.kind === 'map' && (await deps.directory.mapFor(company, content.partnerId))) return COPY.MAP_ALREADY;
  return null;
}

function nameOf(book: PartnerBook | null, file: TrashedFile): string {
  const content = file.content;
  if (!content) return COPY.TRASH_UNREADABLE_NAME;
  if (content.kind === 'businessCase') return content.title || COPY.TRASH_KIND[file.kind];
  if (content.kind === 'program') return content.label;
  return displayNameOf(partnerName(book, content.partnerId), content.partnerType);
}

const needsPartners = (file: TrashedFile): boolean => file.content !== null && file.content.kind !== 'program';

/**
 * Marks as removed, on the MAP `mapId`, each person with an address who has no link to it: a link made and turned off
 * at once, whose token nobody holds. Sending them a link later (Share) lets them in again, as for anyone removed.
 */
async function shutOut(deps: Deps, actor: Actor, mapId: string, people: Array<{ personId: string; side: Side; email: string | null }>): Promise<void> {
  const linked = new Set((await deps.mapLinks.listForMap(mapId)).map((l) => l.personId));
  const at = deps.clock();
  for (const person of people) {
    if (!person.email || linked.has(person.personId)) continue;
    await deps.mapLinks.create({
      id: newMapLinkId(), mapId, ownerUserId: actor.userId, personId: person.personId, side: person.side, emailHash: emailHash(person.email),
      tokenHash: hashToken(newToken()), createdAt: at,
    });
  }
  // Every link on it off at once, also one an earlier restore made and couldn't turn off: a retry finishes the job.
  await deps.mapLinks.revokeMaps([mapId], at);
}

/** The company's trash, the latest deleted first: what each is, when it went, and whether it can come back. Admins. */
export async function listTrash(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<TrashItem[]>> {
  if (!nothing.safeParse(input).success) return invalid();
  if (!deps.trash || !can(actor, 'trash.list', { ownerUserId: actor.userId })) return FORBIDDEN;
  const company = await companyOf(deps, actor.userId);
  const files = await deps.trash.list(company);
  const partners = files.some(needsPartners) ? await partnersOf(deps, company) : { ok: true as const, book: null };
  const items: TrashItem[] = [];
  for (const file of files) {
    // Partners that can't be read now: a case or MAP can't be checked, so it waits (task 2's review).
    const blocked = !partners.ok && needsPartners(file) ? COPY.TRASH_CANT_CHECK
      : await blockedBy(deps, company, partners.ok ? partners.book : null, file);
    items.push({ fileId: file.fileId, kind: file.kind, name: nameOf(partners.ok ? partners.book : null, file), deletedAt: file.trashedAt, blocked });
  }
  return ok(items);
}

/**
 * Brings one item back from the trash (spec §6.4) under the id it had: the file first, claimed in one statement so a
 * second restore at the same time finds nothing, then its directory row; if the row can't be made, the file goes back.
 * Its links stay off: the delete turned them off, and nothing here turns them on (owner, 2026-11-08). A MAP's people
 * who had links count as removed until someone sends them a new one, so no reminder reaches them. Admins.
 */
export async function restoreFromTrash(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ fileId: string; kind: TrashKind; id: string; name: string }>> {
  const parsed = restoreInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!deps.trash || !can(actor, 'trash.restore', { ownerUserId: actor.userId })) return FORBIDDEN;
  const trash = deps.trash;
  const company = await companyOf(deps, actor.userId);
  const file = await trash.get(company, parsed.data.fileId);
  if (!file) return GONE;
  const content = file.content;
  if (!content) return refused('fileId', COPY.TRASH_UNREADABLE);
  let book: PartnerBook | null = null;
  if (needsPartners(file)) {
    const partners = await partnersOf(deps, company);
    if (!partners.ok) return partners;
    book = partners.book;
  }
  const blocked = await blockedBy(deps, company, book, file);
  if (blocked) return refused('fileId', blocked);
  // Before anything comes back: a MAP's people with an address and no link count as removed too, as everyone with a
  // link does since the delete, so no reminder or old email button reaches them until someone sends them a link.
  if (content.kind === 'map') await shutOut(deps, actor, file.formerId, content.people);

  if (!(await trash.restore(file.fileId, file.trashedAt))) return GONE;
  const base = { fileId: file.fileId, ownerUserId: actor.userId, companyId: company };
  const id = content.kind === 'businessCase' ? content.caseId : content.kind === 'program' ? content.programId : file.formerId;
  try {
    if (content.kind === 'businessCase') {
      await deps.directory.addBusinessCase({
        ...base, caseId: id, partnerId: content.partnerId, partnerType: content.partnerType, displayName: content.title, createdAt: content.createdAt,
      });
    } else if (content.kind === 'program') {
      await deps.directory.addProgram({ ...base, programId: id, displayName: content.label, partnerType: content.programType });
    } else {
      const zone = await ownerTimeZone(deps, actor.userId);
      await deps.directory.addMap({
        ...base, mapId: id, partnerId: content.partnerId, partnerType: content.partnerType,
        displayName: displayNameOf(partnerName(book, content.partnerId), content.partnerType), createdAt: file.createdAt,
        // Its first day is the owner's date the file was made: the old row's start isn't kept in the file [builder's call].
        startedOn: localTime(new Date(file.createdAt), zone).date,
      });
    }
  } catch (error) {
    await trash.trash(file.fileId, file.trashedAt).catch(() => logQuietly(deps, 'trash_put_back_failed', { fileId: file.fileId }));
    // A MAP started for the same partner type in the meantime won: one MAP per partner type.
    if (error instanceof DuplicateEntry) return refused('fileId', content.kind === 'map' ? COPY.MAP_ALREADY : COPY.TRASH_TAKEN);
    throw error;
  }
  if (content.kind === 'map') {
    // Its link holders' changes from before the delete were alerted then: the alerts go on after them (task 2's review).
    // Best effort, and never a throw after the MAP is listed again (the final review).
    await (async () => deps.directory.setMapNotifyState(id, { partnerAlertsThrough: await deps.mapEvents.latestId(id) }))()
      .catch(() => logQuietly(deps, 'trash_alert_cursor_failed', { mapId: id }));
  }
  await record(deps, actor, 'trash.restore', file.fileId, [id]);
  // The partner type's row shows its MAP's health again (the delete cleared it). Best effort.
  if (content.kind === 'map') await refreshSummary(deps, actor, company, content.partnerId);
  return ok({ fileId: file.fileId, kind: file.kind, id, name: nameOf(book, file) });
}
