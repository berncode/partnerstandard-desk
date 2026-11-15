'use server';

import {
  changeMap, deleteMap, fillMap, invalid, listMapIds, listMaps, mapNotifySettings, mapSharing, ownerToday, readMap, revokeMapLinks, saveMapNotifySettings, shareMap,
  shiftMapDates, startMap, type MapListItem, type MapSharePerson,
} from '@partner-desk/commands';
import type { NotifySettings } from '@partner-desk/core';
import type { StoreErrorCode } from '@partner-desk/storage';
import { z } from 'zod';
import type { RemoteOutcome } from '@/editor/remote';
import { snapshotOf, type RemoteResult } from '@/maps/remote';
import { mailConfigured, mapLinkFor, sendMapLink } from '@/server/runtime';
import { cardOf, mayDeleteAfter, type MapAreaState } from '@/maps/view-model';
import { asOwner, done, refused } from './context';
import { COPY } from '@partner-desk/copy';

// Every action works on the signed-in person's own company: the company id comes from the session, never the input.
// Each one calls its command (spec 8, one way in).

const listInput = z.object({ partnerId: z.unknown().optional() }).strict();

/** The company's MAPs (of one partner type with `partnerId`), from the directory and one read of Partners. */
export async function mapList(input: unknown): Promise<RemoteOutcome<{ maps: MapListItem[] }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = listInput.safeParse(input ?? {});
    if (!parsed.success) return refused(invalid());
    const { partnerId } = parsed.data;
    const listed = await listMaps(deps, actor, { companyId: await companyId(), ...(partnerId !== undefined ? { partnerId } : {}) });
    return listed.ok ? { ok: true, maps: listed.value } : refused(listed);
  });
}

/**
 * How many MAPs the company has, from the directory alone: it answers while the Partners file is gone, which is when
 * Start a new Partners file asks what happens to them.
 */
export async function mapCount(input: unknown): Promise<RemoteOutcome<{ count: number }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = listInput.safeParse(input ?? {});
    if (!parsed.success) return refused(invalid());
    const { partnerId } = parsed.data;
    const listed = await listMapIds(deps, actor, { companyId: await companyId(), ...(partnerId !== undefined ? { partnerId } : {}) });
    return listed.ok ? { ok: true, count: listed.value.length } : refused(listed);
  });
}

const areaInput = z.object({ partnerId: z.unknown() }).strict();

/**
 * A partner type's Mutual Action Plan area (spec 5.1): its MAP read now, as the Plans page's card shows it. A MAP that
 * can't be read keeps its place, with what the partner record last kept of it and why.
 */
export async function mapArea(input: unknown): Promise<RemoteOutcome<{ state: MapAreaState }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = areaInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const listed = await listMaps(deps, actor, { companyId: await companyId(), partnerId: parsed.data.partnerId });
    if (!listed.ok) return refused(listed);
    const item = listed.value[0];
    if (!item) return { ok: true, state: { kind: 'none' } };
    const today = await ownerToday(deps, actor.userId);
    const { mapId, plannedStart } = item;
    const read = await readMap(deps, actor, { mapId });
    if (!read.ok) {
      return {
        ok: true,
        state: {
          kind: 'unread', mapId, displayName: item.displayName, plannedStart, today, health: item.health, nextMilestone: item.nextMilestone,
          message: read.message, deletable: mayDeleteAfter(read.error),
        },
      };
    }
    return { ok: true, state: { kind: 'ready', mapId, plannedStart, today, card: cardOf(item, read.value, today) } };
  });
}

const startInput = z.object({ partnerId: z.unknown() }).strict();

/** Start the MAP for a partner type (spec 5.1, 5.2): one per partner type. The guided steps fill it next. */
export async function mapStart(input: unknown): Promise<RemoteOutcome<{ mapId: string }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = startInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await startMap(deps, actor, { companyId: await companyId(), partnerId: parsed.data.partnerId }));
  });
}

/** The guided first MAP's rows, added to the MAP in two writes; refused for a MAP filled in already. */
export async function mapFill(input: unknown): Promise<RemoteOutcome<{ mapId: string }>> {
  return asOwner(async ({ deps, actor }) => done(await fillMap(deps, actor, input)));
}

/** Failures a fresh read can't help with: the same account, outage or full Drive stands in the way. */
const NO_FRESH_READ = new Set<StoreErrorCode | 'forbidden'>(['auth', 'unavailable', 'quota']);

const changeInput = z.object({ mapId: z.unknown(), change: z.unknown() }).strict();

/**
 * One change from the MAP page (the MAP app's applyPlanChange): the MAP as its file holds it now, or why not. A refused
 * change comes back with the MAP read again, so the page shows the latest version (the MAP app's conflict prompt).
 */
export async function mapChange(input: unknown): Promise<RemoteResult> {
  return asOwner(async ({ deps, actor }): Promise<RemoteResult> => {
    const parsed = changeInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const out = await changeMap(deps, actor, parsed.data);
    if (out.ok) {
      const { snapshot, entityId, record, startedOn, lastProgressAt } = out.value;
      return { ok: true, snapshot: { ...snapshot, record, startedOn, lastProgressAt }, entityId };
    }
    const fresh = NO_FRESH_READ.has(out.error) ? null : await readMap(deps, actor, { mapId: parsed.data.mapId });
    return { ...refused(out), ...(fresh?.ok ? { snapshot: snapshotOf(fresh.value) } : {}) };
  });
}

const shiftInput = z.object({ mapId: z.unknown() }).strict();

/** Moves the MAP's open dates for its partner type's signing, when the move at signing failed (spec 5.3, ruling R4). */
export async function mapShiftDates(input: unknown): Promise<RemoteOutcome<{ days: number }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = shiftInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await shiftMapDates(deps, actor, parsed.data));
  });
}

const deleteInput = z.object({ mapId: z.unknown() }).strict();

/**
 * Deletes a MAP (spec 8), after the person confirmed: its file goes to the Drive trash, its links stop working, and
 * its partner type can start a new one. Also for a MAP whose file can't be read.
 */
export async function mapDelete(input: unknown): Promise<RemoteOutcome<{ mapId: string }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = deleteInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await deleteMap(deps, actor, parsed.data));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Share (spec 4): the owner's only. A link's token comes back to this screen once, as a link on APP_URL.

const shareInput = z.object({ mapId: z.unknown() }).strict();
const personInput = z.object({ mapId: z.unknown(), personId: z.unknown() }).strict();

/** Who has, or can get, a link, and whether email is set up (Send link). */
export async function mapShareLoad(input: unknown): Promise<RemoteOutcome<{ people: MapSharePerson[]; mailConfigured: boolean }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = shareInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const out = await mapSharing(deps, actor, parsed.data);
    return out.ok ? { ok: true, people: out.value.people, mailConfigured: mailConfigured() } : refused(out);
  });
}

/** A new link for one person, to copy: the MAP app's Copy link. */
export async function mapShareCopy(input: unknown): Promise<RemoteOutcome<{ url: string }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = personInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const out = await shareMap(deps, actor, parsed.data);
    if (!out.ok) return { ...refused(out), message: out.fieldErrors?.personId ?? out.message };
    return { ok: true, url: mapLinkFor(out.value.token) };
  });
}

/**
 * A new link for one person, emailed to them on the owner's behalf: the MAP app's Send link. Only once email is set up;
 * a link that couldn't be emailed still works, and can be copied.
 */
export async function mapShareSend(input: unknown): Promise<RemoteOutcome<{ message: string }>> {
  return asOwner(async ({ deps, actor, sender }) => {
    const parsed = personInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    if (!mailConfigured()) return { ok: false, error: 'invalid' as const, message: COPY.MAP_SHARE_NO_MAIL };
    const out = await shareMap(deps, actor, parsed.data);
    if (!out.ok) return { ...refused(out), message: out.fieldErrors?.personId ?? out.message };
    const { token, email, side } = out.value;
    const to = { ownerUserId: actor.userId, mapId: String(parsed.data.mapId), personId: String(parsed.data.personId), side, email };
    if (!(await sendMapLink(to, token, sender))) return { ok: false, error: 'unavailable' as const, message: COPY.MAP_LINK_NOT_SENT };
    return { ok: true, message: COPY.MAP_LINK_SENT_TO(email) };
  });
}

/** Turns off every link of one person: their sessions end on their next request. */
export async function mapShareRevoke(input: unknown): Promise<RemoteOutcome<{ message: string }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = personInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const out = await revokeMapLinks(deps, actor, parsed.data);
    return out.ok ? { ok: true, message: COPY.MAP_ACCESS_REMOVED } : refused(out);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Notifications: the MAP's email settings, the owner's only.

/** The MAP's email settings, the owner's timezone, and whether email goes out at all. */
export async function mapNotifyLoad(input: unknown): Promise<RemoteOutcome<{ settings: NotifySettings & { timezone: string; mailConfigured: boolean } }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = shareInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const out = await mapNotifySettings(deps, actor, parsed.data);
    return out.ok ? { ok: true, settings: { ...out.value.settings, timezone: out.value.timeZone, mailConfigured: mailConfigured() } } : refused(out);
  });
}

/** Saves the MAP's email settings. */
export async function mapNotifySave(input: unknown): Promise<RemoteOutcome<{ message: string }>> {
  return asOwner(async ({ deps, actor }) => {
    const out = await saveMapNotifySettings(deps, actor, input);
    return out.ok ? { ok: true, message: COPY.MAP_NOTIFY_SAVED } : refused(out);
  });
}
