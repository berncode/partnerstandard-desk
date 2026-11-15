// The page reads the MAP through `readMap` and the POST writes through `changeMap`, both as the link actor of the person
// the reminder went to, so the link page's rules apply (their side and joint activities only, nothing after the exit).
import {
  accessRemoved, changeMap, hashToken, readMap, type Actor, type Deps, type Directory, type Failure, type MapLinks, type RateLimiter,
} from '@partner-desk/commands';
import { ACTIVITY_STATUSES, canChangeMap, STATUS_PHRASE, type Activity as MapActivity, type ActivityStatus as MapActivityStatus, type MapPerson } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { issuedAtOf, shortEmailHash, verifyAction, type ActionClaims, type EmailAction } from './signed-tokens';

/** Per token and per address, fixed one-hour windows, hashed keys (the MAP app's ACTION_LIMITS). */
export const ACTION_LIMITS = { perToken: 10, perIp: 60, windowMs: 3_600_000 } as const;
const NOTE_MAX = 2000;

export interface EmailActionDeps {
  secret: string;
  directory: Pick<Directory, 'map' | 'mapNotifyState'>;
  /** The MAP's links, revoked ones too: removing a person's access refuses their buttons (question 12). */
  mapLinks: Pick<MapLinks, 'listForMap'>;
  /** The commands' dependencies reaching the MAP owner's files; null once the account is gone. */
  ownerDeps: (ownerUserId: string) => Promise<Deps | null>;
  limiter: RateLimiter;
  /** Milliseconds. */
  now: () => number;
  /** Pauses the MAP and emails its owner once (runtime: pauseForAuth after the answer). */
  pause: (mapId: string) => Promise<void>;
  /** Ids only. */
  log: (event: string, ids: Record<string, string>) => void;
}

export interface ConfirmView { action: EmailAction; partnerName: string; title: string; status: MapActivityStatus; note: string; personName: string }
export type ActionNoticeKind = 'invalid' | 'gone' | 'reconnect' | 'unavailable' | 'refused' | 'removed';
export type ActionView = { kind: 'confirm'; view: ConfirmView } | { kind: ActionNoticeKind };
export type ActionFailure = keyof typeof COPY.MAP_ACTION_FAILED;
export type ActionOutcome = { ok: true; message: string } | { ok: false; kind: ActionFailure; message: string };

const fail = (kind: ActionFailure): ActionOutcome => ({ ok: false, kind, message: COPY.MAP_ACTION_FAILED[kind] });

/** Store errors that mean "try again later" to a reminder's recipient: an outage, a locked file, a full Drive, a conflict. */
const TRY_LATER = new Set<string>(['unavailable', 'locked', 'quota', 'conflict']);

/** What a failed read or write means to the person who pressed the button. */
function failureKind(failure: Failure): ActionNoticeKind {
  if (failure.error === 'auth') return 'reconnect';
  if (failure.error === 'not_found' || failure.error === 'file_not_found') return 'gone';
  if (TRY_LATER.has(failure.error)) return 'unavailable';
  return 'refused';
}

/** The person the reminder went to, acting by its button: a link actor, as on the link page. */
const actorFor = (ownerUserId: string, claims: ActionClaims, person: Pick<MapPerson, 'side' | 'name'>): Extract<Actor, { kind: 'link' }> => ({
  kind: 'link', userId: ownerUserId, linkId: `email:${claims.personId}`, mapId: claims.mapId, personId: claims.personId, side: person.side, name: person.name,
});

type Found =
  | { kind: 'ok'; deps: Deps; actor: Extract<Actor, { kind: 'link' }>; partnerName: string; person: MapPerson; activity: MapActivity; exited: boolean }
  | { kind: ActionNoticeKind };

/** The MAP as it is now, and the person and activity the token names, if they still match. */
async function resolve(deps: EmailActionDeps, claims: ActionClaims): Promise<Found> {
  const entry = await deps.directory.map(claims.mapId);
  if (!entry) return { kind: 'gone' };
  // The person's access was removed, now or after this button's email was made: before the pause and any Google read.
  let links;
  try {
    links = await deps.mapLinks.listForMap(claims.mapId);
  } catch {
    deps.log('email_action_links_failed', { mapId: claims.mapId });
    return { kind: 'unavailable' };
  }
  if (accessRemoved(links, claims.personId, new Date(issuedAtOf(claims)).toISOString())) return { kind: 'removed' };
  if ((await deps.directory.mapNotifyState(claims.mapId))?.pausedReason) return { kind: 'reconnect' };
  const owner = await deps.ownerDeps(entry.ownerUserId);
  if (!owner) return { kind: 'gone' };
  // Read as the person (their side is filled in once they are found): the same read the link page makes.
  const read = await readMap(owner, actorFor(entry.ownerUserId, claims, { side: 'partner', name: '' }), { mapId: claims.mapId });
  if (!read.ok) return { kind: read.error === 'file_not_found' ? 'gone' : failureKind(read) };
  const plan = read.value.value;
  const person = plan.people.find((p) => p.id === claims.personId);
  // The address the reminder went to must still be this person's: changing it in the sheet ends old buttons.
  if (!person?.email || shortEmailHash(person.email) !== claims.emailHash) return { kind: 'invalid' };
  const activity = plan.activities.find((a) => a.id === claims.activityId);
  if (!activity) return { kind: 'gone' };
  // Given to someone else since: the button no longer speaks for its owner.
  if (activity.ownerId !== person.id) return { kind: 'invalid' };
  return {
    kind: 'ok', deps: owner, actor: actorFor(entry.ownerUserId, claims, person), partnerName: read.value.info.partnerName, person, activity,
    exited: read.value.record.stage === 'exit',
  };
}

/** "Mark done" and "In progress" fix the status in the token; only "Update…" takes it from the form. */
function statusFor(action: EmailAction, chosen: unknown): MapActivityStatus | null {
  if (action === 'done') return 'done';
  if (action === 'in_progress') return 'in_progress';
  return typeof chosen === 'string' && (ACTIVITY_STATUSES as readonly string[]).includes(chosen) ? (chosen as MapActivityStatus) : null;
}

/** GET: what the confirmation page shows. It only reads: no write, no pause, no rate limit, since link scanners open it. */
export async function viewAction(deps: EmailActionDeps, token: unknown): Promise<ActionView> {
  const claims = verifyAction(deps.secret, token, deps.now());
  if (!claims) return { kind: 'invalid' };
  const found = await resolve(deps, claims);
  if (found.kind !== 'ok') return { kind: found.kind };
  const { activity, person, actor } = found;
  // The same check the POST makes: don't offer a button that can only be refused.
  const status = statusFor(claims.action, activity.status) ?? activity.status;
  const decision = canChangeMap(
    { kind: 'link', personId: actor.personId, side: actor.side, name: actor.name },
    { kind: 'update', entity: 'activity', id: activity.id, patch: { status } }, { people: [person], activities: [activity], objectives: [] },
  );
  if (found.exited || !decision.allowed) return { kind: 'refused' };
  return {
    kind: 'confirm',
    view: { action: claims.action, partnerName: found.partnerName, title: activity.title, status: activity.status, note: activity.note, personName: person.name },
  };
}

/** POST: verify, limit, re-read, then write through `changeMap` as the person, with the link page's rules. */
export async function performAction(deps: EmailActionDeps, token: unknown, input: { status?: unknown; note?: unknown }, ip: string | null): Promise<ActionOutcome> {
  const nowMs = deps.now();
  const { perToken, perIp, windowMs } = ACTION_LIMITS;
  // Every POST counts against its address, valid link or not; the link's own limit only once it verifies.
  if (!(await deps.limiter.hit(`map_action:ip:${hashToken(ip ?? 'unknown')}`, perIp, windowMs, nowMs))) return fail('limited');
  const claims = verifyAction(deps.secret, token, nowMs);
  if (!claims) return fail('invalid');
  if (!(await deps.limiter.hit(`map_action:token:${hashToken(String(token))}`, perToken, windowMs, nowMs))) return fail('limited');

  const status = statusFor(claims.action, input.status);
  const note = claims.action === 'update' ? input.note : undefined;
  if (!status || (note !== undefined && (typeof note !== 'string' || note.length > NOTE_MAX))) return fail('bad_input');

  const found = await resolve(deps, claims);
  if (found.kind === 'reconnect') {
    await deps.pause(claims.mapId);
    return fail('reconnect');
  }
  if (found.kind !== 'ok') return fail(found.kind);

  const patch: Record<string, unknown> = { status };
  if (typeof note === 'string') patch.note = note.trim();
  const result = await changeMap(found.deps, found.actor, {
    mapId: claims.mapId, change: { kind: 'update', entity: 'activity', id: found.activity.id, patch, expectedUpdatedAt: found.activity.updatedAt },
  });
  if (result.ok) return { ok: true, message: COPY.MAP_ACTION_DONE(found.activity.title, STATUS_PHRASE[status]) };
  const kind = failureKind(result);
  if (kind === 'reconnect') await deps.pause(claims.mapId);
  return fail(kind);
}
