// Each MAP is read through `readMapForJob` as its owner, which also refreshes the partner type's MAP health and next
// milestone (spec 5.7); the rules (reminders, digest, partner alerts, momentum) are core's copies of the MAP app's. Ids
// and counts in logs; MAP content only in the emails, to the MAP's people.
import {
  accessRemoved, readMapForJob, type Actor, type Deps, type Directory, type EmailPrefs, type JobMap, type LogType, type MapEvent, type MapEventLog,
  type MapLinks, type MapSessions, type NotificationLog, type ProposalIndex, type RateLimiter, type WebhookStore, notifySettingsOf,
} from '@partner-desk/commands';
import {
  afterExit, alertLines, bundleByRecipient, daysWithoutProgress, digestSection, endedWithoutSigning, isAddress, isDailyHour, isDigestTime, isQuiet,
  localTime, momentumChange, momentumState, momentumSuggestion, normalizeAddress, notifyKeys as keys, nudgesFor, partnerAlertDecision, PROPOSAL_INDEX_KEEP_DAYS,
  type AlertEvent, type DigestSection, type IsoDate, type IsoDateTime, type JoinedPlan, type LocalTime, type NotificationType,
  type NotifySettings, type NudgeItem, type RecipientBundle,
} from '@partner-desk/core';
import { COPY, MAP_HEALTH_LABELS } from '@partner-desk/copy';
import { RESOLVE_TIMEOUT_MS } from '@partner-desk/platform';
import { formatMapDate } from '@/maps/format';
import { digestEmail, type DigestAudience, type DigestEmailSection } from './emails/digest';
import { momentumEmail } from './emails/momentum';
import { nudgeEmail, type NudgeEmailItem } from './emails/nudge';
import { partnerAlertEmail } from './emails/partner-alert';
import { reconnectEmail } from './emails/reconnect';
import type { RenderedEmail } from './emails/render';
import type { Mailer } from './mailer';
import { shortEmailHash, signAction, signUnsubscribe, type EmailAction } from './signed-tokens';
import { queueTickWebhooks } from './tick-webhooks';
import { REQUEST_TIMEOUT_MS } from './webhook-delivery';

/**
 * The MAP's owner in its emails. `email`: where replies go, and the reconnect email; none on a company server.
 * `recipients`: our side's people for the emails to the owner (the owner on hosted; every admin and partner manager on
 * a company server, plan 15). `team`: a company server's, where each recipient has their own "sent once" mark.
 */
export interface OwnerContact {
  userId: string; name: string; email: string | null; recipients: Array<{ name: string; email: string }>; team: boolean;
}

/** The MAP's owner: who they are, and the commands' dependencies reaching their files. Null once the account is gone. */
export type OwnerOf = (ownerUserId: string) => Promise<{ contact: OwnerContact; deps: Deps } | null>;

export interface NotifyDeps {
  directory: Pick<Directory, 'jobMaps' | 'map' | 'setMapNotifyState' | 'pauseMap' | 'setMapWebhookHealth'>;
  dedupe: NotificationLog;
  prefs: EmailPrefs;
  mapEvents: Pick<MapEventLog, 'since'>;
  /** The MAPs' links, revoked ones too: who changed what, and whose access was removed (question 12). */
  links: Pick<MapLinks, 'get' | 'listForMap'>;
  /** The owner's timezone (Settings, else Europe/Berlin). */
  timeZoneOf: (ownerUserId: string) => Promise<string>;
  /** Null while email isn't set up: the job still refreshes the partner rows, and sends nothing. */
  mailer: Mailer | null;
  owner: OwnerOf;
  /** The owners' webhooks: who is subscribed, and the queue the MAPs' events go into (agents spec 7.2). */
  webhooks: Pick<WebhookStore, 'subscriptions' | 'enqueue'>;
  /** Sends the due webhook deliveries, everyone's, for at most `deadlineMs` (webhook-delivery's `deliverDue`). */
  deliverWebhooks: (now: Date, deadlineMs: number) => Promise<{ sent: number; failed: number; turnedOff: number }>;
  appUrl: string;
  /** Signs the email buttons and unsubscribe links (BETTER_AUTH_SECRET, a key per purpose). */
  secret: string;
  /** Milliseconds, for the deadline only; the `now` given to runTick drives everything else. */
  clock: () => number;
  deadlineMs: number;
  log: (event: string, ids: Record<string, string>) => void;
}

export interface TickCounts {
  maps: number; read: number; refreshed: number; sent: number; failed: number; paused: number; cutShort: boolean;
  /** Webhook deliveries this run sent, failed to send, and webhooks it turned off (3 days failing). */
  webhooksSent: number; webhooksFailed: number; webhooksTurnedOff: number;
}

/** Reads in flight at once: each read is a few Google calls against the owner's per-user limits. */
const READS_AT_ONCE = 4;
/** Reading stops this long before the deadline, keeping time for the sends that follow. */
export const SEND_RESERVE_MS = 15_000;
/** The job's own deadline: Vercel gives the function 60 seconds. */
export const TICK_DEADLINE_MS = 50_000;
/** Kept free after the webhook sends, inside the job's deadline, for the hourly clean-up the route runs next [builder's call]. */
export const CLEANUP_RESERVE_MS = 5_000;

interface Job {
  map: JobMap; settings: NotifySettings; local: LocalTime; daily: boolean; digest: boolean; alerts: AlertEvent[];
  /** The owner's timezone, as `local` was worked out in. */
  timeZone: string;
}
interface Loaded extends Job {
  contact: OwnerContact; plan: JoinedPlan; lastEventAt: IsoDateTime;
  /** The people whose access to the MAP was removed: no reminders, no weekly copy (question 12). */
  removed: ReadonlySet<string>;
}

interface Tick {
  deps: NotifyDeps;
  mailer: Mailer | null;
  now: Date;
  nowIso: IsoDateTime;
  started: number;
  counts: TickCounts;
  /** MAPs whose work this run didn't finish (deadline, failed email): not marked done, so the next run redoes them. */
  unfinished: Set<string>;
  /** Keys claimed and not yet sent or given back: a throw gives them back so the next run retries. */
  held: Set<string>;
  owners: Map<string, Promise<{ contact: OwnerContact; deps: Deps } | null>>;
}

const late = (tick: Tick, reserveMs = 0): boolean => tick.deps.clock() - tick.started > tick.deps.deadlineMs - reserveMs;

function cut(tick: Tick, mapIds: string[]): void {
  tick.counts.cutShort = true;
  for (const id of mapIds) tick.unfinished.add(id);
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}

async function mapLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export const mapUrl = (appUrl: string, mapId: string): string => `${appUrl}/plans/${mapId}`;
const unsubscribeUrl = (deps: Pick<NotifyDeps, 'appUrl' | 'secret'>, email: string, type: NotificationType) =>
  `${deps.appUrl}/n/u/${signUnsubscribe(deps.secret, email, type)}`;

/** RFC 8058 one-click unsubscribe, on every email that isn't transactional. */
export function unsubscribeHeaders(deps: Pick<NotifyDeps, 'appUrl' | 'secret'>, email: string, type: NotificationType): Record<string, string> {
  return {
    'List-Unsubscribe': `<${deps.appUrl}/api/unsubscribe/${signUnsubscribe(deps.secret, email, type)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** The owner as the commands see them: their own reads, as the job, at the run's time. */
const ownerActor = (contact: OwnerContact): Actor => ({ kind: 'owner', userId: contact.userId, displayName: contact.name });

/**
 * Whether one email to our side is done, so the MAP's state may move on: no send failed (hosted, the owner's one), or at
 * least one went out (a company server, plan 15). A member whose send fails, even once, misses that email (logged); the
 * others never get a second copy [builder's call, task 5's review].
 */
class Sends {
  private tried = 0;
  private sent = 0;
  add(ok: boolean): void {
    this.tried += 1;
    if (ok) this.sent += 1;
  }
  get done(): boolean {
    return this.tried === 0 || this.sent > 0;
  }
}

/**
 * Our side's people for one email to the owner, those who turned it off left out, each with their "sent once" key: the
 * key itself on hosted, the key and the address on a company server, so one member's mark never stops another's.
 */
async function ourSide(deps: NotifyDeps, contact: OwnerContact, type: NotificationType, key: string): Promise<Array<{ name: string; email: string; key: string }>> {
  const list = contact.recipients.filter((r) => r.email);
  if (list.length === 0) return [];
  const off = await deps.prefs.unsubscribed(list.map((r) => r.email), type);
  return list.filter((r) => !off.has(r.email)).map((r) => ({ ...r, key: contact.team ? `${key}:${normalizeAddress(r.email)}` : key }));
}

function ownerOf(tick: Tick, ownerUserId: string) {
  if (!tick.owners.has(ownerUserId)) tick.owners.set(ownerUserId, tick.deps.owner(ownerUserId));
  return tick.owners.get(ownerUserId)!;
}

/**
 * One run of the scheduled job (Vercel Cron, every 15 minutes). In the owner's 08:00 hour each MAP is read once a day:
 * that read refreshes the partner type's MAP health and next milestone (spec 5.7), and with email set up the reminders,
 * Monday's digest, partner alerts and momentum warnings go out. Partner alerts set to instant go out on any run. Safe
 * to run any number of times: every send is claimed in the email log first.
 */
export async function runTick(deps: NotifyDeps, now: Date): Promise<{ skipped: null } & TickCounts> {
  const tick: Tick = {
    deps, mailer: deps.mailer, now, nowIso: now.toISOString(), started: deps.clock(),
    counts: { maps: 0, read: 0, refreshed: 0, sent: 0, failed: 0, paused: 0, cutShort: false, webhooksSent: 0, webhooksFailed: 0, webhooksTurnedOff: 0 },
    unfinished: new Set(), held: new Set(), owners: new Map(),
  };
  const jobs = await mapJobs(tick);
  const loaded = await readMaps(tick, jobs);
  await queueWebhooks(tick, loaded);
  const daily = loaded.filter((l) => l.daily);
  if (tick.mailer) {
    await sendNudges(tick, daily);
    for (const l of daily) await guarded(tick, 'notify_momentum_failed', [l.map.mapId], () => sendMomentum(tick, l));
    await sendDigests(tick, loaded.filter((l) => l.digest), jobs);
    for (const l of loaded) await guarded(tick, 'notify_alert_failed', [l.map.mapId], () => sendAlert(tick, l));
  }
  await markDailyDone(tick, daily);
  await deliverWebhooks(tick);
  if (tick.counts.cutShort) {
    const { maps, read, sent } = tick.counts;
    deps.log('tick_cut_short', { maps: String(maps), read: String(read), sent: String(sent) });
  }
  return { skipped: null, ...tick.counts };
}

/**
 * The webhook events of the MAPs just read (tick-webhooks.ts), before the emails: database work only. A MAP it had no
 * time for is left unfinished, so the next run reads it again.
 */
async function queueWebhooks(tick: Tick, loaded: Loaded[]): Promise<void> {
  const read = loaded.map((l) => ({ map: l.map, plan: l.plan, today: l.local.date, timeZone: l.timeZone, lastEventAt: l.lastEventAt }));
  const skipped = await queueTickWebhooks(tick.deps, read, () => late(tick, SEND_RESERVE_MS));
  if (skipped.length > 0) cut(tick, skipped);
}

/**
 * Last, the due webhook deliveries (everyone's, retries too). `deliverDue` checks its deadline only before it claims the
 * next one, and a delivery can take the address check's whole lookup, then a whole request: so it gets what the run has
 * left less those two and the clean-up's reserve, and the last send still ends inside the job's deadline. None when
 * nothing is left.
 */
async function deliverWebhooks(tick: Tick): Promise<void> {
  const { deps } = tick;
  const budget = deps.deadlineMs - (deps.clock() - tick.started) - RESOLVE_TIMEOUT_MS - REQUEST_TIMEOUT_MS - CLEANUP_RESERVE_MS;
  if (budget <= 0) return;
  try {
    const result = await deps.deliverWebhooks(tick.now, budget);
    tick.counts.webhooksSent = result.sent;
    tick.counts.webhooksFailed = result.failed;
    tick.counts.webhooksTurnedOff = result.turnedOff;
  } catch (error) {
    deps.log('webhook_delivery_run_failed', { error: error instanceof Error ? error.name : 'unknown' });
  }
}

async function mapJobs(tick: Tick): Promise<Job[]> {
  const { deps } = tick;
  // A paused MAP waits for its owner's Google access: no reads, no emails, and its alert cursor stays put.
  const active = (await deps.directory.jobMaps()).filter((m) => !m.notify.pausedReason);
  tick.counts.maps = active.length;
  const zones = new Map<string, string>();
  for (const ownerUserId of new Set(active.map((m) => m.ownerUserId))) zones.set(ownerUserId, await deps.timeZoneOf(ownerUserId));
  const located = active.map((map) => {
    const timeZone = zones.get(map.ownerUserId) ?? 'UTC';
    return { map, timeZone, local: localTime(tick.now, timeZone) };
  });
  const done = await deps.dedupe.existing(located.filter((x) => isDailyHour(x.local)).map((x) => keys.daily(x.map.mapId, x.local.date)), tick.nowIso);
  const jobs = located.map(({ map, timeZone, local }): Job => {
    const daily = isDailyHour(local) && !done.has(keys.daily(map.mapId, local.date));
    return { map, settings: notifySettingsOf(map.notify.settings), local, timeZone, daily, digest: daily && isDigestTime(local), alerts: [] };
  });
  if (tick.mailer) {
    const watching = jobs.filter((j) => j.settings.partnerAlerts === 'instant' || (j.settings.partnerAlerts === 'daily' && j.daily));
    await mapLimited(watching, 8, async (job) => {
      job.alerts = (await deps.mapEvents.since(job.map.mapId, job.map.notify.partnerAlertsThrough)).map(alertEvent);
    });
  }
  return jobs.filter((j) => j.daily || partnerAlertDecision(j.settings.partnerAlerts, j.alerts, tick.now, j.daily).send);
}

const alertEvent = (e: MapEvent): AlertEvent => ({ ...e });

async function readMaps(tick: Tick, jobs: Job[]): Promise<Loaded[]> {
  const { deps } = tick;
  const loaded = new Map<string, Loaded>();
  const readOne = async (job: Job) => {
    const { mapId, ownerUserId } = job.map;
    if (late(tick, SEND_RESERVE_MS)) {
      cut(tick, [mapId]);
      return;
    }
    try {
      const owner = await ownerOf(tick, ownerUserId);
      if (!owner) {
        deps.log('notify_owner_gone', { mapId });
        return;
      }
      // The run's time is the commands' clock: "today" is the owner's day at the time the run stands for.
      const read = await readMapForJob({ ...owner.deps, clock: () => tick.nowIso }, ownerActor(owner.contact), { mapId });
      if (read.ok) {
        tick.counts.read += 1;
        if (read.value.refreshed === 'written') tick.counts.refreshed += 1;
        const removed = await removedPeople(tick, mapId);
        if (removed) loaded.set(mapId, { ...job, contact: owner.contact, plan: read.value.plan, lastEventAt: read.value.lastEventAt, removed });
      } else if (read.error === 'auth') {
        if (await pauseFor(deps, job.map, owner.contact, tick.nowIso)) tick.counts.paused += 1;
      } else {
        // A file gone, a broken tab, a partner row it can't read, Google not answering: nothing for this MAP now, and
        // the next run tries again (its day isn't marked done).
        deps.log('notify_read_failed', { mapId, error: read.error });
      }
    } catch {
      deps.log('notify_map_failed', { mapId });
    }
  };
  // One owner's MAPs are read one after another (their Google budget); owners run side by side.
  await mapLimited([...groupBy(jobs, (j) => j.map.ownerUserId).values()], READS_AT_ONCE, async (lane) => {
    for (const job of lane) await readOne(job);
  });
  return jobs.flatMap((j) => loaded.get(j.map.mapId) ?? []);
}

/**
 * The people whose access to the MAP was removed. Null when the links can't be read: the MAP isn't loaded, so nothing
 * is sent for it this run and the next run tries again, since no email beats one to a removed person [builder's call].
 * Like a failed read, it doesn't hold back the owner's digest of their other MAPs.
 */
async function removedPeople(tick: Tick, mapId: string): Promise<Set<string> | null> {
  try {
    const links = await tick.deps.links.listForMap(mapId);
    return new Set(links.map((l) => l.personId).filter((personId) => accessRemoved(links, personId)));
  } catch {
    tick.deps.log('notify_links_failed', { mapId });
    return null;
  }
}

/** Claim, send, mark sent; or give everything back on failure so the next run retries. */
async function deliver(tick: Tick, d: { to: string; email: RenderedEmail; replyTo: string | null; type: NotificationType; keys: string[]; mapIds: string[] }): Promise<boolean> {
  const sent = await tick.mailer!.send(
    { to: d.to, ...d.email, ...(d.replyTo ? { replyTo: d.replyTo } : {}), headers: unsubscribeHeaders(tick.deps, d.to, d.type) },
    { type: d.type, mapIds: d.mapIds.join(',') },
  );
  if (sent.ok) {
    // Sent: these keys stay claimed whatever happens next, or the email would go out twice.
    for (const key of d.keys) tick.held.delete(key);
    for (const key of d.keys) await tick.deps.dedupe.markSent(key, sent.id, tick.nowIso);
    tick.counts.sent += 1;
    return true;
  }
  for (const key of d.keys) await release(tick, key);
  for (const id of d.mapIds) tick.unfinished.add(id);
  tick.counts.failed += 1;
  tick.deps.log('notify_send_failed', { type: d.type, mapIds: d.mapIds.join(',') });
  return false;
}

async function claim(tick: Tick, key: string, meta: { type: LogType; mapId: string | null; recipientEmail: string | null }): Promise<boolean> {
  const won = await tick.deps.dedupe.claim(key, meta, tick.nowIso);
  if (won) tick.held.add(key);
  return won;
}

async function release(tick: Tick, key: string): Promise<void> {
  await tick.deps.dedupe.release(key);
  tick.held.delete(key);
}

/** One email's or MAP's work: a throw gives back its claims, leaves its MAPs unfinished and lets the run go on. */
async function guarded(tick: Tick, event: string, mapIds: string[], work: () => Promise<void>): Promise<void> {
  const before = new Set(tick.held);
  try {
    await work();
  } catch (error) {
    for (const key of [...tick.held].filter((k) => !before.has(k))) {
      try {
        await release(tick, key);
      } catch {
        tick.held.delete(key); // the claim expires on its own
      }
    }
    for (const id of mapIds) tick.unfinished.add(id);
    tick.counts.failed += 1;
    tick.deps.log(event, { mapIds: mapIds.join(','), error: error instanceof Error ? error.name : 'unknown' });
  }
}

/** Rounds per recipient per day: more than a run schedule can produce. */
const NUDGE_ROUNDS = 96;

/** The first free round: one email per owner-timezone group, so no group's items wait for another's. */
async function claimNudgeRound(tick: Tick, email: string, date: IsoDate): Promise<string | null> {
  for (let round = 1; round <= NUDGE_ROUNDS; round++) {
    const key = keys.nudgeEmail(email, date, round);
    if (await claim(tick, key, { type: 'nudge_email', mapId: null, recipientEmail: email })) return key;
  }
  return null;
}

function nudgeView(tick: Tick, item: NudgeItem, from: Loaded): NudgeEmailItem {
  const today = from.local.date;
  const dueOn = formatMapDate(item.dueDate, today);
  const when = item.kind === 'overdue' ? COPY.MAP_NUDGE_OVERDUE(item.days, dueOn) : COPY.MAP_NUDGE_DUE(item.days, dueOn);
  const url = (action: EmailAction) => `${tick.deps.appUrl}/n/a/${signAction(tick.deps.secret, {
    mapId: item.planId, activityId: item.activityId, action, personId: item.personId, emailHash: shortEmailHash(item.email),
  }, tick.now.getTime())}`;
  return {
    planName: from.plan.info.partnerName || from.map.displayName, title: item.title, when, overdue: item.kind === 'overdue',
    urls: { done: url('done'), inProgress: url('in_progress'), update: url('update') },
  };
}

/** Due and overdue reminders, one email per person across every MAP read for the day's work. */
async function sendNudges(tick: Tick, daily: Loaded[]): Promise<void> {
  const { deps } = tick;
  const sources = new Map<string, Loaded>();
  const all: NudgeItem[] = [];
  for (const l of daily) {
    try {
      for (const item of nudgesFor(l.map.mapId, l.plan, l.local.date, l.settings.dueSoonDays)) {
        if (l.removed.has(item.personId)) continue;
        all.push(item);
        sources.set(item.key, l);
      }
    } catch (error) {
      tick.unfinished.add(l.map.mapId);
      tick.counts.failed += 1;
      deps.log('notify_nudge_failed', { mapId: l.map.mapId, error: error instanceof Error ? error.name : 'unknown' });
    }
  }
  if (all.length === 0) return;
  const claimed = await deps.dedupe.existing(all.map((i) => i.key), tick.nowIso);
  const pending = all.filter((i) => !claimed.has(i.key));
  const off = await deps.prefs.unsubscribed([...new Set(pending.map((i) => i.email))], 'nudges');
  for (const bundle of bundleByRecipient(pending.filter((i) => !off.has(i.email)))) {
    const mapIds = [...new Set(bundle.items.map((i) => i.planId))];
    if (late(tick)) {
      cut(tick, mapIds);
      continue;
    }
    await guarded(tick, 'notify_nudge_failed', mapIds, () => sendNudgeBundle(tick, bundle, (item) => sources.get(item.key)!));
  }
}

async function sendNudgeBundle(tick: Tick, bundle: RecipientBundle, from: (item: NudgeItem) => Loaded): Promise<void> {
  const date = bundle.items.map((i) => from(i).local.date).sort()[0]!;
  const emailKey = await claimNudgeRound(tick, bundle.email, date);
  if (!emailKey) {
    tick.deps.log('nudge_deferred', { mapIds: [...new Set(bundle.items.map((i) => i.planId))].join(',') });
    return;
  }
  const items: NudgeItem[] = [];
  for (const item of bundle.items) {
    if (await claim(tick, item.key, { type: 'nudge_item', mapId: item.planId, recipientEmail: item.email })) items.push(item);
  }
  if (items.length === 0) {
    await release(tick, emailKey);
    return;
  }
  const owners = new Set(items.map((i) => from(i).contact.email));
  const replyTo = owners.size === 1 ? [...owners][0]! : null;
  const email = await nudgeEmail({
    personName: bundle.personName, items: items.map((i) => nudgeView(tick, i, from(i))), unsubscribeUrl: unsubscribeUrl(tick.deps, bundle.email, 'nudges'),
  });
  await deliver(tick, { to: bundle.email, email, replyTo, type: 'nudges', keys: [emailKey, ...items.map((i) => i.key)], mapIds: [...new Set(items.map((i) => i.planId))] });
}

/** A warning per change for the worse; improvements are stored silently. */
async function sendMomentum(tick: Tick, l: Loaded): Promise<void> {
  const { deps } = tick;
  const { mapId } = l.map;
  const today = l.local.date;
  const current = momentumState(l.plan, today, l.lastEventAt);
  const change = momentumChange(current, l.map.notify.momentumState);
  if (change === 'none') return;
  const store = () => deps.directory.setMapNotifyState(mapId, { momentumState: current });
  if (change === 'store' || current === 'on_track') return store();
  if (late(tick)) return cut(tick, [mapId]);
  const sends = new Sends();
  for (const to of await ourSide(deps, l.contact, 'momentum', keys.momentum(mapId, current, today))) {
    if (late(tick)) return cut(tick, [mapId]);
    if (!(await claim(tick, to.key, { type: 'momentum', mapId, recipientEmail: to.email }))) continue;
    const email = await momentumEmail({
      partnerName: l.map.displayName, state: current, days: daysWithoutProgress(l.plan, today, l.lastEventAt),
      suggestion: momentumSuggestion(mapId, today), planUrl: mapUrl(deps.appUrl, mapId), unsubscribeUrl: unsubscribeUrl(deps, to.email, 'momentum'),
    });
    sends.add(await deliver(tick, { to: to.email, email, replyTo: null, type: 'momentum', keys: [to.key], mapIds: [mapId] }));
  }
  if (sends.done) await store();
}

function digestView(tick: Tick, s: DigestSection, l: Loaded, forPartner: boolean): DigestEmailSection {
  const today = l.local.date;
  return {
    partnerName: forPartner ? s.partnerName || l.map.displayName : l.map.displayName,
    planUrl: forPartner ? null : mapUrl(tick.deps.appUrl, s.planId),
    health: s.health === 'empty' ? COPY.MAP_NOTHING_PLANNED : MAP_HEALTH_LABELS[s.health],
    healthChange: s.healthChange ? `${MAP_HEALTH_LABELS[s.healthChange.from]} → ${MAP_HEALTH_LABELS[s.healthChange.to]}` : null,
    done: s.doneLastWeek.map((a) => a.title),
    dueThisWeek: s.dueThisWeek.map((a) => COPY.MAP_DIGEST_DUE(a.title, formatMapDate(a.dueDate, today))),
    overdue: s.overdue.map((a) => COPY.MAP_DIGEST_OVERDUE(a.title, a.days)),
    blocked: s.blocked.map((a) => a.title),
  };
}

interface Evaluated { l: Loaded; mapId: string; section: DigestSection }

async function sendDigest(tick: Tick, d: {
  to: string; name: string; key: string; audience: DigestAudience; replyTo: string | null; sections: Evaluated[];
}): Promise<boolean> {
  const mapIds = d.sections.map((s) => s.mapId);
  if (late(tick)) {
    cut(tick, mapIds);
    return false;
  }
  if (!(await claim(tick, d.key, { type: 'digest', mapId: mapIds.length === 1 ? mapIds[0]! : null, recipientEmail: d.to }))) return true;
  const email = await digestEmail({
    recipientName: d.name, audience: d.audience, unsubscribeUrl: unsubscribeUrl(tick.deps, d.to, 'digest'),
    sections: d.sections.map((s) => digestView(tick, s.section, s.l, d.audience.kind === 'partner')),
  });
  return deliver(tick, { to: d.to, email, replyTo: d.replyTo, type: 'digest', keys: [d.key], mapIds });
}

/** Monday: one email per owner covering their MAPs with news, and the partner copies the owner turned on. */
async function sendDigests(tick: Tick, due: Loaded[], jobs: Job[]): Promise<void> {
  for (const [ownerUserId, list] of groupBy(due, (l) => l.map.ownerUserId)) {
    await guarded(tick, 'notify_digest_failed', list.map((l) => l.map.mapId), () => sendOwnerDigest(tick, ownerUserId, list, jobs));
  }
}

async function sendOwnerDigest(tick: Tick, ownerUserId: string, list: Loaded[], jobs: Job[]): Promise<void> {
  const { deps } = tick;
  // If the deadline kept some of this owner's MAPs unread, the next run sends the whole digest. A failed read doesn't wait.
  const unread = jobs.some((j) => j.digest && j.map.ownerUserId === ownerUserId && tick.unfinished.has(j.map.mapId) && !list.some((l) => l.map.mapId === j.map.mapId));
  if (unread) {
    cut(tick, list.map((l) => l.map.mapId));
    return;
  }
  const today = list[0]!.local.date;
  const contact = list[0]!.contact;
  // A recruitment that ended without signing has no week to report.
  const evaluated: Evaluated[] = list.filter((l) => !endedWithoutSigning(l.plan.info))
    .map((l) => ({ l, mapId: l.map.mapId, section: digestSection(l.map.mapId, l.plan, today, l.lastEventAt, l.map.notify.digestHealth) }));
  const news = evaluated.filter((e) => !isQuiet(e.section));
  let ok = true;
  if (news.length > 0) {
    for (const to of await ourSide(deps, contact, 'digest', keys.digest(ownerUserId, today))) {
      ok = (await sendDigest(tick, { to: to.email, name: to.name, key: to.key, audience: { kind: 'owner' }, replyTo: null, sections: news })) && ok;
    }
  }
  // After the partner type's exit the partner gets no weekly copy (ruling R7); the owner's digest may still list it.
  for (const e of news.filter((n) => n.l.settings.partnerDigest && !afterExit(n.l.plan.info))) {
    const partners = e.l.plan.people
      .filter((p) => p.side === 'partner' && p.email && isAddress(normalizeAddress(p.email)) && !e.l.removed.has(p.id))
      .map((p) => ({ name: p.name, email: normalizeAddress(p.email!) }));
    const off = await deps.prefs.unsubscribed(partners.map((p) => p.email), 'digest');
    for (const partner of partners.filter((p) => !off.has(p.email))) {
      const sent = await sendDigest(tick, {
        to: partner.email, name: partner.name, key: keys.digestPartner(e.mapId, partner.email, today),
        audience: { kind: 'partner', ownerName: contact.name }, replyTo: contact.email, sections: [e],
      });
      ok = sent && ok;
    }
  }
  // An empty MAP has no health to compare next week (owner, 2026-10-31): none is kept for it.
  if (ok) for (const e of evaluated) await deps.directory.setMapNotifyState(e.mapId, { digestHealth: e.section.health === 'empty' ? null : e.section.health });
}

/** The names behind the changes: the MAP's People, through the link or the email button. */
async function actorNames(deps: NotifyDeps, events: AlertEvent[], plan: JoinedPlan): Promise<(actorRef: string) => string> {
  const names = new Map<string, string>();
  for (const ref of new Set(events.map((e) => e.actorRef))) {
    const fromEmail = ref.startsWith('email:');
    const link = fromEmail ? null : await deps.links.get(ref);
    const personId = fromEmail ? ref.slice('email:'.length) : link?.personId;
    names.set(ref, plan.people.find((p) => p.id === personId)?.name || COPY.MAP_ALERT_SOMEONE);
  }
  return (ref) => names.get(ref) ?? COPY.MAP_ALERT_SOMEONE;
}

/** One summary of the new changes by people with a link, then the cursor moves past them. */
async function sendAlert(tick: Tick, l: Loaded): Promise<void> {
  const { deps } = tick;
  const { mapId } = l.map;
  const decision = partnerAlertDecision(l.settings.partnerAlerts, l.alerts, tick.now, l.daily);
  if (!decision.send) return;
  if (late(tick)) return cut(tick, [mapId]);
  const moveCursor = () => deps.directory.setMapNotifyState(mapId, { partnerAlertsThrough: decision.throughId });
  const sends = new Sends();
  let lines: ReturnType<typeof alertLines> | null = null;
  for (const to of await ourSide(deps, l.contact, 'partner_alerts', keys.partnerAlert(mapId, decision.throughId))) {
    if (late(tick)) return cut(tick, [mapId]);
    if (!(await claim(tick, to.key, { type: 'partner_alert', mapId, recipientEmail: to.email }))) continue;
    lines ??= alertLines(l.alerts, l.plan, await actorNames(deps, l.alerts, l.plan));
    const email = await partnerAlertEmail({
      partnerName: l.map.displayName, lines, planUrl: mapUrl(deps.appUrl, mapId), unsubscribeUrl: unsubscribeUrl(deps, to.email, 'partner_alerts'),
    });
    sends.add(await deliver(tick, { to: to.email, email, replyTo: null, type: 'partner_alerts', keys: [to.key], mapIds: [mapId] }));
  }
  if (sends.done) await moveCursor();
}

/** Later runs in the same 08:00 hour skip MAPs whose day is done. */
async function markDailyDone(tick: Tick, daily: Loaded[]): Promise<void> {
  for (const l of daily) {
    if (tick.unfinished.has(l.map.mapId)) continue;
    const key = keys.daily(l.map.mapId, l.local.date);
    await guarded(tick, 'notify_mark_failed', [l.map.mapId], async () => {
      if (await claim(tick, key, { type: 'daily', mapId: l.map.mapId, recipientEmail: null })) {
        tick.held.delete(key);
        await tick.deps.dedupe.markSent(key, null, tick.nowIso);
      }
    });
  }
}

/**
 * The owner's Google access is broken: pauses the MAP once (its emails stop, its link holders see "can't be reached
 * right now") and sends the owner one Reconnect email a day at most. True when this call paused it.
 */
async function pauseFor(deps: NotifyDeps, map: Pick<JobMap, 'mapId' | 'ownerUserId'>, contact: OwnerContact, nowIso: IsoDateTime): Promise<boolean> {
  const paused = await deps.directory.pauseMap(map.mapId);
  if (paused) deps.log('map_paused_auth', { mapId: map.mapId });
  if (!deps.mailer || !contact.email) return paused;
  const key = keys.reconnect(map.ownerUserId, nowIso.slice(0, 10));
  if (await deps.dedupe.claim(key, { type: 'reconnect', mapId: map.mapId, recipientEmail: contact.email }, nowIso)) {
    const email = await reconnectEmail({ ownerName: contact.name, signInUrl: `${deps.appUrl}/sign-in` });
    const sent = await deps.mailer.send({ to: contact.email, ...email }, { type: 'reconnect', mapId: map.mapId });
    if (sent.ok) await deps.dedupe.markSent(key, sent.id, nowIso);
    else await deps.dedupe.release(key);
  }
  return paused;
}

/**
 * A person with a link, or an email button, met the owner's broken Google access: pauses the MAP and tells the owner
 * (the MAP app's pauseForAuth). Best effort: logged with ids only. The next good read of the MAP resumes it.
 */
export async function pauseForAuth(deps: NotifyDeps, mapId: string, now: Date): Promise<void> {
  try {
    const entry = await deps.directory.map(mapId);
    if (!entry) return;
    const owner = await deps.owner(entry.ownerUserId);
    if (!owner) return;
    await pauseFor(deps, { mapId, ownerUserId: entry.ownerUserId }, owner.contact, now.toISOString());
  } catch {
    deps.log('map_pause_failed', { mapId });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Hourly housekeeping (the MAP app's cleanup.ts)

export interface CleanupDeps {
  sessions: Pick<MapSessions, 'deleteExpired'>;
  rateLimits: Pick<RateLimiter, 'prune'>;
  dedupe: Pick<NotificationLog, 'prune'>;
  mapEvents: Pick<MapEventLog, 'prune'>;
  /** The webhook queue (platform's `TursoWebhooks.prune`): deliveries done or given up 7 days ago, marks after 90. */
  webhooks: { prune(nowMs: number): Promise<{ deliveries: number; marks: number }> };
  /** The proposal index: waiting ones past their expiry become expired, answered ones go after 90 days (spec 7.2, 8). */
  proposals: Pick<ProposalIndex, 'expire' | 'prune'>;
  /** Better Auth's verification rows past their time: unused sign-in links, each with its address (plan 14). */
  verifications: { pruneExpired(now: Date): Promise<number> };
  /** A company server's invites past their 7 days, each with the address it named (plan 15). */
  invites: { pruneExpired(now: Date): Promise<number> };
  log: (event: string, ids: Record<string, string>) => void;
}

export type CleanupResult = {
  sessions: number; rateLimits: number; notifications: number; mapEvents: number; webhookDeliveries: number; webhookMarks: number;
  proposalsExpired: number; proposalsPruned: number; verifications: number; invites: number;
};

/** Rate-limit windows are at most an hour long; a day keeps a wide margin. */
export const RATE_LIMIT_KEEP_MS = 24 * 60 * 60_000;
/** Link holders' changes older than this are in an alert long since, or never will be [builder's call]. */
export const MAP_EVENTS_KEEP_MS = 30 * 24 * 60 * 60_000;

/** Answered proposals (an expired one: from its expiry) leave our index after this; the Drive rows stay [builder's call]. */
export const PROPOSALS_KEEP_MS = PROPOSAL_INDEX_KEEP_DAYS * 24 * 60 * 60_000;

/** The first run of each hour cleans up. The job runs every 15 minutes, so one run an hour qualifies. */
export const shouldClean = (now: Date): boolean => now.getUTCMinutes() < 15;

/**
 * Each step on its own: one failing is logged with its name and counts 0, and the rest still run. By age only. Expiring
 * proposals changes our index only, no Google call (spec 7.3) [builder's call: here, once an hour]: until it runs, the
 * screens and the counts treat a proposal past its expiry as expired by the date.
 */
export async function runCleanup(deps: CleanupDeps, now: Date): Promise<CleanupResult> {
  const step = async <T>(name: string, work: () => Promise<T>, none: T): Promise<T> => {
    try {
      return await work();
    } catch {
      deps.log('cleanup_step_failed', { step: name });
      return none;
    }
  };
  const result = {
    sessions: await step('sessions', () => deps.sessions.deleteExpired(now.toISOString()), 0),
    rateLimits: await step('rate_limits', () => deps.rateLimits.prune(now.getTime() - RATE_LIMIT_KEEP_MS), 0),
    notifications: await step('notifications', () => deps.dedupe.prune(now), 0),
    mapEvents: await step('map_events', () => deps.mapEvents.prune(new Date(now.getTime() - MAP_EVENTS_KEEP_MS).toISOString()), 0),
  };
  const webhooks = await step('webhooks', () => deps.webhooks.prune(now.getTime()), { deliveries: 0, marks: 0 });
  const proposalsExpired = await step('proposals_expire', () => deps.proposals.expire(now.toISOString()), 0);
  const proposalsPruned = await step('proposals_prune', () => deps.proposals.prune(new Date(now.getTime() - PROPOSALS_KEEP_MS).toISOString()), 0);
  const verifications = await step('verifications', () => deps.verifications.pruneExpired(now), 0);
  const invites = await step('invites', () => deps.invites.pruneExpired(now), 0);
  return { ...result, webhookDeliveries: webhooks.deliveries, webhookMarks: webhooks.marks, proposalsExpired, proposalsPruned, verifications, invites };
}
