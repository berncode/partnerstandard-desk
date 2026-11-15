// A MAP's magic links and sessions, on the commands: a link and a session are rows of PartnerStandard Desk's tables, the
// MAP is found in the directory, a link is made by a command with an access check and an event, and the address a link
// went to is kept as a hash only.
import { randomSuffix, type IsoDateTime, type Side } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import { can } from './access';
import type { Actor } from './actor';
import { type Deps, wordsOf } from './deps';
import type { MapLink } from './directory';
import { logQuietly, refused } from './shared';
import { FORBIDDEN, fromStore, invalid, isOwner, ok, record, type CommandResult, type Failure } from './result';
import { hashToken, isToken, newToken } from './share-tokens';

export const MAP_LINK_IDLE_DAYS = 90;
export const MAP_SESSION_DAYS = 30;
export const MAP_RELINK_LIMITS = { perEmail: 5, perIp: 20, windowMs: 3_600_000 } as const;

const DAY_MS = 86_400_000;
/** A session in use is renewed, and its link's last use recorded, at most this often. */
const TOUCH_EVERY_MS = 3_600_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const id = z.string().min(1).max(64);
const shareInput = z.object({ mapId: id, personId: id }).strict();

/** No longer in the directory, in the words of where the work lives. */
const notListed = (deps: Deps): Failure => ({ ok: false, error: 'file_not_found', message: wordsOf(deps).MAP_NOT_LISTED });

/** Link and session ids appear in logs and events, so they are ids, not secrets: the secret is the token. */
export const newMapLinkId = (): string => `ml_${randomSuffix(16)}`;
const newMapSessionId = (): string => `ms_${randomSuffix(16)}`;

/** A MAP id as `newMapId` makes them: anything else from a request is never looked up or logged. */
const isMapId = (value: unknown): value is string => typeof value === 'string' && /^map_[0-9a-z]{10}$/.test(value);

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
/** What a link keeps of the address it went to. */
export const emailHash = (email: string): string => hashToken(normalizeEmail(email));
const later = (iso: IsoDateTime, ms: number): IsoDateTime => new Date(Date.parse(iso) + ms).toISOString();

export type MapLinkState = 'active' | 'expired' | 'revoked';

/** Revoked by the owner, idle for more than 90 days (from its last use, else its creation), or active. */
export function mapLinkState(link: MapLink, now: IsoDateTime): MapLinkState {
  if (link.revokedAt) return 'revoked';
  return Date.parse(now) - Date.parse(link.lastUsedAt ?? link.createdAt) > MAP_LINK_IDLE_DAYS * DAY_MS ? 'expired' : 'active';
}

/**
 * The person's access to the MAP was removed (question 12): they had a link, and every one of their links is revoked;
 * or, given `since`, one of their links was revoked at or after it, so a share made later doesn't bring back what came
 * before. Someone who never had a link isn't removed, nor is someone whose link is only idle. Pure: no clock.
 */
export function accessRemoved(links: readonly MapLink[], personId: string, since?: IsoDateTime): boolean {
  const mine = links.filter((l) => l.personId === personId);
  if (mine.length === 0) return false;
  if (mine.every((l) => l.revokedAt !== null)) return true;
  return since !== undefined && mine.some((l) => l.revokedAt !== null && Date.parse(l.revokedAt) >= Date.parse(since));
}

/** What opening a link, or finding a session, needs: our tables only, never the owner's files. */
export type MapAccessDeps = Pick<Deps, 'directory' | 'mapLinks' | 'mapSessions' | 'clock' | 'log'>;

/** The link's MAP is still listed, and still its owner's: deleted, removed with its partner type, or its owner gone, it isn't. */
async function mapStands(deps: MapAccessDeps, link: MapLink): Promise<boolean> {
  const entry = await deps.directory.map(link.mapId);
  return entry !== null && entry.ownerUserId === link.ownerUserId;
}

// ---------------------------------------------------------------------------------------------------------------------
// The owner's commands

/**
 * A new magic link for one person of the MAP, on their side (spec 4, Share). Gives back the token, which only the
 * owner's screen ever holds, to copy or to send (with the person's address and side, to send it to); the database keeps its hash and the hash of the person's address.
 * A decision: a person only (spec 8).
 */
export async function shareMap(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ token: string; linkId: string; email: string; side: Side }>> {
  const parsed = shareInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId, personId } = parsed.data;
  const entry = await deps.directory.map(mapId);
  if (!entry || !isOwner(actor, entry)) return notListed(deps);
  if (!can(actor, 'maps.share', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const person = read.snapshot.value.people.find((p) => p.id === personId);
  if (!person) return refused('personId', COPY.MAP_PERSON_GONE);
  if (!person.email) return refused('personId', COPY.MAP_PERSON_NO_EMAIL);
  const token = newToken();
  const linkId = newMapLinkId();
  await deps.mapLinks.create({
    id: linkId, mapId, ownerUserId: entry.ownerUserId, personId, side: person.side, emailHash: emailHash(person.email),
    tokenHash: hashToken(token), createdAt: deps.clock(),
  });
  await record(deps, actor, 'maps.share', entry.fileId, [mapId, personId, linkId]);
  return ok({ token, linkId, email: person.email, side: person.side });
}

/** Turns off every link of one person on one MAP; their sessions end on their next request (Revoke). */
export async function revokeMapLinks(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ revoked: number }>> {
  const parsed = shareInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId, personId } = parsed.data;
  const entry = await deps.directory.map(mapId);
  if (!entry || !isOwner(actor, entry)) return notListed(deps);
  if (!can(actor, 'maps.revoke', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const revoked = await deps.mapLinks.revokePerson(mapId, personId, deps.clock());
  await record(deps, actor, 'maps.revoke', entry.fileId, [mapId, personId]);
  return ok({ revoked });
}

/** One person the Share dialog lists: someone on People with an email, or someone taken off People who still has a link. */
export interface MapSharePerson {
  personId: string;
  /** Null for someone no longer on People: their name and address went with their row, and we keep only a hash. */
  name: string | null;
  side: Side;
  email: string | null;
  /** Their links' latest use. */
  lastUsedAt: IsoDateTime | null;
  /** One of their links works now: not revoked, used within 90 days. */
  active: boolean;
  inPlan: boolean;
}

/**
 * Who has, or can get, a link to the MAP (the Share dialog, MAP app's `shareState`): the people on People with an email,
 * on both sides, and anyone taken off People whose link isn't revoked yet, so the owner can still revoke it. Owner only.
 */
export async function mapSharing(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ people: MapSharePerson[] }>> {
  const parsed = z.object({ mapId: id }).strict().safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId } = parsed.data;
  const entry = await deps.directory.map(mapId);
  if (!entry || !isOwner(actor, entry)) return notListed(deps);
  if (!can(actor, 'maps.share', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const links = await deps.mapLinks.listForMap(mapId);
  const now = deps.clock();
  const summary = (personId: string) => {
    const mine = links.filter((l) => l.personId === personId);
    const lastUsedAt = mine.map((l) => l.lastUsedAt).filter((v): v is IsoDateTime => v !== null).sort().at(-1) ?? null;
    return { mine, lastUsedAt, active: mine.some((l) => mapLinkState(l, now) === 'active') };
  };
  const { people } = read.snapshot.value;
  const listed: MapSharePerson[] = people.filter((p) => p.email).map((p) => {
    const { lastUsedAt, active } = summary(p.id);
    return { personId: p.id, name: p.name, side: p.side, email: p.email, lastUsedAt, active, inPlan: true };
  });
  const known = new Set(people.map((p) => p.id));
  const removed = [...new Set(links.map((l) => l.personId))].filter((personId) => !known.has(personId)).flatMap((personId) => {
    const { mine, lastUsedAt, active } = summary(personId);
    // Anyone with a link not revoked can still ask for a new one, so the owner must be able to revoke them.
    if (!mine.some((l) => l.revokedAt === null)) return [];
    return [{ personId, name: null, side: mine.at(-1)!.side, email: null, lastUsedAt, active, inPlan: false }];
  });
  await record(deps, actor, 'maps.read', entry.fileId, [mapId]);
  return ok({ people: [...listed, ...removed] });
}

// ---------------------------------------------------------------------------------------------------------------------
// The link holder

export type OpenedMapLink =
  | { kind: 'session'; mapId: string; sessionToken: string; expiresAt: IsoDateTime }
  | { kind: 'expired'; mapId: string }
  | { kind: 'invalid' };

/**
 * Swaps a magic link's token for a new browser session (MAP §6.3). The token stays usable until it is revoked or idle
 * for 90 days. A link to a MAP that is gone (deleted, its partner type removed, its owner's account deleted) opens
 * nothing (Review Focus 4). Opening a link only starts a session: it never changes a plan.
 */
export async function openMapLink(deps: MapAccessDeps, token: unknown): Promise<OpenedMapLink> {
  if (!isToken(token)) return { kind: 'invalid' };
  const link = await deps.mapLinks.findByTokenHash(hashToken(token));
  if (!link) return { kind: 'invalid' };
  const now = deps.clock();
  const state = mapLinkState(link, now);
  if (state === 'revoked' || !(await mapStands(deps, link))) return { kind: 'invalid' };
  if (state === 'expired') return { kind: 'expired', mapId: link.mapId };
  const sessionToken = newToken();
  const expiresAt = later(now, MAP_SESSION_DAYS * DAY_MS);
  await deps.mapSessions.create({ id: newMapSessionId(), linkId: link.id, mapId: link.mapId, tokenHash: hashToken(sessionToken), expiresAt });
  await deps.mapLinks.touch(link.id, now);
  return { kind: 'session', mapId: link.mapId, sessionToken, expiresAt };
}

export type ResolvedMapSession =
  | { kind: 'active'; actor: Extract<Actor, { kind: 'link' }> }
  | { kind: 'expired'; mapId: string }
  | { kind: 'revoked' }
  | { kind: 'none' };

/**
 * The person behind a session cookie, for the MAP in the URL only, as an actor for the MAP commands. Checked on every
 * request, so revoking a link, deleting the MAP or removing its partner type ends the session at once, and the session
 * row goes. Use renews the session and records the link's use, at most once an hour. The actor's `name` is '': the MAP
 * commands read it from the MAP's People.
 */
export async function resolveMapSession(deps: MapAccessDeps, sessionToken: unknown, mapId: string): Promise<ResolvedMapSession> {
  if (!isToken(sessionToken)) return { kind: 'none' };
  const session = await deps.mapSessions.findByTokenHash(hashToken(sessionToken));
  if (!session || session.mapId !== mapId) return { kind: 'none' };
  const end = async () => {
    try {
      await deps.mapSessions.delete(session.id);
    } catch {
      logQuietly(deps, 'map_session_end_failed', { mapId });
    }
  };
  const link = await deps.mapLinks.get(session.linkId);
  if (!link || link.mapId !== mapId || !(await mapStands(deps, link))) {
    await end();
    return { kind: 'none' };
  }
  const now = deps.clock();
  const state = mapLinkState(link, now);
  if (state === 'revoked') {
    await end();
    return { kind: 'revoked' };
  }
  if (state === 'expired' || Date.parse(session.expiresAt) <= Date.parse(now)) {
    await end();
    return { kind: 'expired', mapId };
  }
  // Each session renews on its own clock, and the link's use is recorded on its own; both at most hourly.
  if (Date.parse(session.expiresAt) - Date.parse(now) < MAP_SESSION_DAYS * DAY_MS - TOUCH_EVERY_MS) {
    await deps.mapSessions.extend(session.id, later(now, MAP_SESSION_DAYS * DAY_MS));
  }
  if (!link.lastUsedAt || Date.parse(now) - Date.parse(link.lastUsedAt) >= TOUCH_EVERY_MS) await deps.mapLinks.touch(link.id, now);
  return {
    kind: 'active',
    actor: { kind: 'link', userId: link.ownerUserId, linkId: link.id, mapId, personId: link.personId, side: link.side, name: '' },
  };
}

/**
 * Ends one browser session of the MAP in the URL: Sign out, and a MAP that is gone for the person (its partner type taken
 * out of Partners by hand, Review Focus 4). Only its own MAP's session; anything else changes nothing. Best effort:
 * logged with the MAP's id only.
 */
export async function endMapSession(deps: MapAccessDeps, sessionToken: unknown, mapId: string): Promise<void> {
  if (!isToken(sessionToken)) return;
  const session = await deps.mapSessions.findByTokenHash(hashToken(sessionToken));
  if (!session || session.mapId !== mapId) return;
  try {
    await deps.mapSessions.delete(session.id);
  } catch {
    logQuietly(deps, 'map_session_end_failed', { mapId });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Asking for a new link

/** Sends a new link by email (task 8). `email` is the address the person typed, which matched their link's. */
export interface MapLinkMail {
  sendLink(to: { ownerUserId: string; mapId: string; personId: string; side: Side; email: string }, token: string): Promise<void>;
}

export type RelinkDeps = MapAccessDeps & Pick<Deps, 'rateLimits'> & {
  /** Null while email isn't set up. */
  mail: MapLinkMail | null;
  /** Runs `work` after the answer was sent, so how long the answer takes can't tell whether the address matched. */
  defer: (work: () => Promise<void>) => void;
};

/**
 * "My link expired" (MAP §3.2): a new link goes to `email` only when a link of the MAP that was not revoked went to
 * that address. Both rate limits are counted first, and the answer is the same whether or not the address matched.
 */
export async function requestNewMapLink(
  deps: RelinkDeps, input: { mapId: unknown; email: unknown; ip: string | null },
): Promise<{ ok: boolean; message: string }> {
  const { email: given, mapId } = input;
  if (typeof given !== 'string' || given.length > 254 || !EMAIL.test(normalizeEmail(given))) return { ok: false, message: COPY.MAP_RELINK_BAD_EMAIL };
  const email = normalizeEmail(given);
  const nowMs = Date.parse(deps.clock());
  const { perEmail, perIp, windowMs } = MAP_RELINK_LIMITS;
  const byEmail = await deps.rateLimits.hit(`map_relink:email:${hashToken(email)}`, perEmail, windowMs, nowMs);
  const byIp = await deps.rateLimits.hit(`map_relink:ip:${hashToken(input.ip ?? 'unknown')}`, perIp, windowMs, nowMs);
  if (!byEmail || !byIp) return { ok: false, message: COPY.MAP_RELINK_LIMITED };
  const mail = deps.mail;
  if (!mail) return { ok: false, message: COPY.MAP_RELINK_NO_MAIL };

  // Everything that depends on whether the address matched happens after the answer, so timing can't tell.
  deps.defer(async () => {
    try {
      if (!isMapId(mapId)) return;
      const hash = emailHash(email);
      const matches = (await deps.mapLinks.listForMap(mapId)).filter((l) => l.revokedAt === null && l.emailHash === hash);
      if (matches.length === 0) return;
      const entry = await deps.directory.map(mapId);
      if (!entry) return;
      for (const personId of new Set(matches.map((m) => m.personId))) {
        const latest = matches.filter((m) => m.personId === personId).at(-1)!;
        if (latest.ownerUserId !== entry.ownerUserId) continue;
        // The side the link was made for wins over today's sheet (the MAP app's Decision 10).
        const token = newToken();
        await deps.mapLinks.create({
          id: newMapLinkId(), mapId, ownerUserId: entry.ownerUserId, personId, side: latest.side, emailHash: hash,
          tokenHash: hashToken(token), createdAt: deps.clock(),
        });
        await mail.sendLink({ ownerUserId: entry.ownerUserId, mapId, personId, side: latest.side, email }, token);
      }
    } catch {
      // Nothing here may reach the caller, and nothing but the MAP's id may be logged.
      logQuietly(deps, 'map_relink_failed', isMapId(mapId) ? { mapId } : {});
    }
  });
  return { ok: true, message: COPY.MAP_RELINK_SENT };
}
