import { describe, expect, it, vi } from 'vitest';

/** Lets a test make core's `summarizeMap` throw, as a bug in a pure rule would; the real one otherwise. */
const core = vi.hoisted(() => ({ summarizeMapThrows: false }));
vi.mock('@partner-desk/core', async (original) => {
  const real = await original<typeof import('@partner-desk/core')>();
  return {
    ...real,
    summarizeMap: (...args: Parameters<typeof real.summarizeMap>) => {
      if (core.summarizeMapThrows) throw new TypeError('a rule broke');
      return real.summarizeMap(...args);
    },
  };
});
import {
  addressHash, changeMap, changePartner, MemoryEmailPrefs, MemoryNotificationLog, openMapLink, readPartners, resolveMapSession, revokeMapLinks,
  saveMapNotifySettings, shareMap, startMap, turnOffWebhook, turnOnWebhook, type Actor, type Deps,
} from '@partner-desk/commands';
import { makeTestDeps, TEST_NOW } from '@partner-desk/commands/testing';
import { MARK_KEEP_MS, type MapChange, type WebhookEvent } from '@partner-desk/core';
import { RESOLVE_TIMEOUT_MS } from '@partner-desk/platform';
import { MemoryMailer } from './mailer';
import { CLEANUP_RESERVE_MS, pauseForAuth, runCleanup, runTick, shouldClean, type NotifyDeps } from './map-notifications';
import { verifyAction } from './signed-tokens';
import { LATE_WINDOW_DAYS } from './tick-webhooks';
import { deliverDue, REQUEST_TIMEOUT_MS } from './webhook-delivery';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const companyId = 'co_aaaaaaaaaa';
const SECRET = 'test-secret-that-is-at-least-32-characters';
const APP = 'https://desk.test';
/** Tuesday 3 November 2026, 08:30 in Berlin (CET): the day's work. */
const TUE_0830 = new Date('2026-11-03T07:30:00.000Z');
/** The same morning, 08:45: a second run in the same hour. */
const TUE_0845 = new Date('2026-11-03T07:45:00.000Z');
/** 10:30 in Berlin: no daily work. */
const TUE_1030 = new Date('2026-11-03T09:30:00.000Z');

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

type TestDeps = ReturnType<typeof makeTestDeps>;

async function addMap(deps: TestDeps, company: string) {
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company } } }));
  const partnerId = value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller', whyItFits: 'Fits' } },
  })).entityId!;
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const add = async (entity: 'activity' | 'person', values: Record<string, unknown>) =>
    value(await changeMap(deps, owner, { mapId, change: { kind: 'add', entity, values } })).entityId!;
  return { partnerId, mapId, add };
}

/** Acme's MAP: Ben (our side) has an activity due tomorrow, Lena (partner) one two days overdue. */
async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa' } });
  await readPartners(deps, owner, { companyId });
  const acme = await addMap(deps, 'Acme');
  const ben = await acme.add('person', { side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'marketing_lead' });
  const lena = await acme.add('person', { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'sales_lead' });
  const soon = await acme.add('activity', { title: 'Send the pricing sheet', side: 'us', ownerId: ben, dueDate: '2026-11-04' });
  const overdue = await acme.add('activity', { title: 'Book the kickoff', side: 'partner', ownerId: lena, dueDate: '2026-11-01' });
  const mailer = new MemoryMailer();
  const logged: Array<[string, Record<string, string>]> = [];
  const notify: NotifyDeps & { dedupe: MemoryNotificationLog; prefs: MemoryEmailPrefs } = {
    directory: deps.directory, dedupe: new MemoryNotificationLog(), prefs: new MemoryEmailPrefs(), mapEvents: deps.mapEvents, links: deps.mapLinks,
    timeZoneOf: async () => 'Europe/Berlin', mailer,
    owner: async (userId) => (userId === 'u1' ? { contact: { userId: 'u1', name: 'Ruth', email: 'ruth@example.com', recipients: [{ name: 'Ruth', email: 'ruth@example.com' }], team: false }, deps } : null),
    webhooks: deps.webhooks, deliverWebhooks: vi.fn(async () => ({ sent: 0, failed: 0, turnedOff: 0 })),
    appUrl: APP, secret: SECRET, clock: () => 0, deadlineMs: 50_000, log: (event, ids) => { logged.push([event, ids]); },
  };
  return { deps, notify, mailer, logged, acme, ben, lena, soon, overdue };
}

const to = (mailer: MemoryMailer, address: string) => mailer.outbox.filter((m) => m.to === address);

describe('runTick: reminders', () => {
  it('sends each person one email a day in their owner’s 08:00 hour, with buttons that open a confirmation page', async () => {
    const { notify, mailer } = await setup();
    expect(await runTick(notify, TUE_1030)).toMatchObject({ maps: 1, read: 0, sent: 0 });
    const first = await runTick(notify, TUE_0830);
    expect(first).toMatchObject({ maps: 1, read: 1, sent: 2, failed: 0 });
    const [ben] = to(mailer, 'ben@example.com');
    expect(ben!.subject).toBe('Coming up: Send the pricing sheet');
    expect(ben!.replyTo).toBe('ruth@example.com');
    expect(ben!.headers!['List-Unsubscribe']).toMatch(/^<https:\/\/desk\.test\/api\/unsubscribe\/[\w-]+\.[\w-]{43}>$/);
    expect(to(mailer, 'lena@example.com')[0]!.subject).toBe('Overdue: Book the kickoff');
    const links = ben!.text.match(/https:\/\/desk\.test\/n\/a\/[\w-]+\.[\w-]+/g)!;
    expect(links).toHaveLength(3);
    expect(verifyAction(SECRET, links[0]!.split('/n/a/')[1], TUE_0830.getTime())).toMatchObject({ action: 'done' });

    // A second run in the same hour, and another the same day, send nothing more.
    expect(await runTick(notify, TUE_0845)).toMatchObject({ read: 0, sent: 0 });
    expect(mailer.outbox).toHaveLength(2);
  });

  it('bundles one person’s activities across MAPs into one email', async () => {
    const { deps, notify, mailer } = await setup();
    const northwind = await addMap(deps, 'Northwind');
    const ben2 = await northwind.add('person', { side: 'us', name: 'Ben Ito', title: '', email: 'Ben@Example.com', role: 'marketing_lead' });
    await northwind.add('activity', { title: 'Train the sales team', side: 'us', ownerId: ben2, dueDate: '2026-10-30' });
    await runTick(notify, TUE_0830);
    const ben = to(mailer, 'ben@example.com');
    expect(ben).toHaveLength(1);
    expect(ben[0]!.subject).toBe('2 activities need your attention');
  });

  it('leaves out a person who unsubscribed from reminders', async () => {
    const { notify, mailer } = await setup();
    await notify.prefs.unsubscribe(addressHash('lena@example.com'), 'nudges', TEST_NOW);
    await runTick(notify, TUE_0830);
    expect(mailer.outbox.map((m) => m.to)).toEqual(['ben@example.com']);
  });

  it('gives a failed send back, so the next run sends it', async () => {
    const { notify, mailer } = await setup();
    const failing = { send: vi.fn(async () => ({ ok: false as const })) };
    expect(await runTick({ ...notify, mailer: failing }, TUE_0830)).toMatchObject({ sent: 0, failed: 2 });
    expect(await runTick(notify, TUE_0845)).toMatchObject({ read: 1, sent: 2 });
    expect(mailer.outbox).toHaveLength(2);
  });
});

describe('runTick: a person whose access was removed (question 12)', () => {
  /** Shares Acme's MAP with the person, then removes their access, as the Share dialog does. */
  async function remove(deps: TestDeps, mapId: string, personId: string) {
    value(await shareMap(deps, owner, { mapId, personId }));
    value(await revokeMapLinks(deps, owner, { mapId, personId }));
  }

  it('a person whose access was removed gets no reminder; the others on the MAP still do', async () => {
    const { deps, notify, mailer, acme, lena } = await setup();
    await remove(deps, acme.mapId, lena);
    expect(await runTick(notify, TUE_0830)).toMatchObject({ read: 1, sent: 1, failed: 0 });
    expect(mailer.outbox.map((m) => [m.to, m.subject])).toEqual([['ben@example.com', 'Coming up: Send the pricing sheet']]);
  });

  it('a removed partner gets no weekly copy of the digest; the owner’s digest still lists the MAP', async () => {
    const { deps, notify, mailer, acme, lena } = await setup();
    await acme.add('person', { side: 'partner', name: 'Mia Chen', title: '', email: 'mia@example.com', role: 'other' });
    value(await saveMapNotifySettings(deps, owner, { mapId: acme.mapId, settings: { dueSoonDays: 3, partnerDigest: true, partnerAlerts: 'off' } }));
    await remove(deps, acme.mapId, lena);
    await runTick(notify, new Date('2026-11-09T07:30:00.000Z'));
    const digest = to(mailer, 'ruth@example.com').find((m) => m.subject === 'Your MAP with Acme as reseller this week')!;
    expect(digest.text).toContain('Acme');
    expect(to(mailer, 'mia@example.com').map((m) => m.subject)).toEqual(['Ruth: your mutual action plan this week']);
    expect(to(mailer, 'lena@example.com')).toEqual([]);
  });

  it('shared again, their reminders come back', async () => {
    const { deps, notify, mailer, acme, lena } = await setup();
    await remove(deps, acme.mapId, lena);
    await runTick(notify, TUE_0830);
    expect(to(mailer, 'lena@example.com')).toEqual([]);
    value(await shareMap(deps, owner, { mapId: acme.mapId, personId: lena }));
    await runTick(notify, new Date('2026-11-04T07:30:00.000Z'));
    expect(to(mailer, 'lena@example.com').map((m) => m.subject)).toEqual(['Overdue: Book the kickoff']);
  });

  it('when the links can’t be read, the MAP’s emails wait for the next run; the owner’s digest of the others still goes', async () => {
    const { deps, notify, mailer, acme, logged } = await setup();
    const northwind = await addMap(deps, 'Northwind');
    const kai = await northwind.add('person', { side: 'us', name: 'Kai Berg', title: '', email: 'kai@example.com', role: 'other' });
    await northwind.add('activity', { title: 'Train the sales team', side: 'us', ownerId: kai, dueDate: '2026-11-05' });
    const listForMap = deps.mapLinks.listForMap.bind(deps.mapLinks);
    const failing: NotifyDeps = {
      ...notify,
      links: {
        get: deps.mapLinks.get.bind(deps.mapLinks),
        listForMap: async (mapId) => { if (mapId === acme.mapId) throw new Error('db down'); return listForMap(mapId); },
      },
    };
    // Monday: nothing about Acme goes out, Northwind's reminder and the owner's digest do.
    const MON_0830 = new Date('2026-11-09T07:30:00.000Z');
    const MON_0845 = new Date('2026-11-09T07:45:00.000Z');
    await runTick(failing, MON_0830);
    expect(to(mailer, 'ben@example.com')).toEqual([]);
    expect(to(mailer, 'lena@example.com')).toEqual([]);
    expect(to(mailer, 'kai@example.com').map((m) => m.subject)).toEqual(['Overdue: Train the sales team']);
    const digest = to(mailer, 'ruth@example.com').filter((m) => /this week/.test(m.subject));
    expect(digest.map((m) => m.subject)).toEqual(['Your MAP with Northwind as reseller this week']);
    expect(logged).toContainEqual(['notify_links_failed', { mapId: acme.mapId }]);
    // Acme's day wasn't marked done: the next run in the hour sends its reminders.
    await runTick(notify, MON_0845);
    expect(to(mailer, 'ben@example.com').map((m) => m.subject)).toEqual(['Overdue: Send the pricing sheet']);
    expect(to(mailer, 'lena@example.com').map((m) => m.subject)).toEqual(['Overdue: Book the kickoff']);
  });
});

describe('runTick: the health refresh (spec 5.7)', () => {
  it('writes the partner row when days passing changed the MAP’s health, once, and only rows of MAPs', async () => {
    const { deps, notify } = await setup();
    const writes: unknown[] = [];
    const apply = deps.partnerBooks.apply.bind(deps.partnerBooks);
    deps.partnerBooks.apply = async (...args) => { writes.push(args[1]); return apply(...args); };
    // Seven weeks without a change: off track.
    const later = new Date('2026-12-22T07:30:00.000Z');
    expect(await runTick({ ...notify, mailer: null }, later)).toMatchObject({ read: 1, refreshed: 1, sent: 0 });
    expect(writes).toEqual([expect.objectContaining({ kind: 'setMapSummary', health: 'off_track' })]);
    const partners = value(await readPartners(deps, owner, { companyId })).value.partners;
    expect(partners.map((p) => p.mapHealth)).toEqual(['off_track']);
    // The next day nothing changed: nothing is written.
    expect(await runTick({ ...notify, mailer: null }, new Date('2026-12-23T07:30:00.000Z'))).toMatchObject({ read: 1, refreshed: 0 });
    expect(writes).toHaveLength(1);
  });

  it('skips a MAP whose Partners file it can’t read: writes nothing, logs ids only, and tries again next run', async () => {
    const { deps, notify, logged, acme } = await setup();
    const read = deps.partnerBooks.read.bind(deps.partnerBooks);
    const apply = vi.spyOn(deps.partnerBooks, 'apply');
    deps.partnerBooks.read = async () => ({ ok: false, error: 'unavailable', message: 'Google isn’t answering' });
    expect(await runTick(notify, TUE_0830)).toMatchObject({ read: 0, sent: 0 });
    expect(apply).not.toHaveBeenCalled();
    expect(logged).toContainEqual(['notify_read_failed', { mapId: acme.mapId, error: 'unavailable' }]);
    expect(JSON.stringify(logged)).not.toMatch(/Acme|Ben|example|pricing/);
    deps.partnerBooks.read = read;
    expect(await runTick(notify, TUE_0845)).toMatchObject({ read: 1, sent: 2 });
  });
});

describe('runTick: momentum, digest and partner alerts', () => {
  it('warns the owner once when the MAP slips for lack of progress', async () => {
    const { notify, mailer } = await setup();
    // 14+ days after the last change: at risk.
    await runTick(notify, new Date('2026-11-12T07:30:00.000Z'));
    const warnings = to(mailer, 'ruth@example.com').filter((m) => /no progress/.test(m.subject));
    expect(warnings.map((m) => m.subject)).toEqual(['Acme as reseller: no progress for 15 days']);
    await runTick(notify, new Date('2026-11-13T07:30:00.000Z'));
    expect(to(mailer, 'ruth@example.com').filter((m) => /no progress/.test(m.subject))).toHaveLength(1);
  });

  it('sends the owner Monday’s digest, and a partner copy only when turned on', async () => {
    const { deps, notify, mailer, acme } = await setup();
    await runTick(notify, new Date('2026-11-02T07:30:00.000Z'));
    expect(to(mailer, 'ruth@example.com').map((m) => m.subject)).toEqual(['Your MAP with Acme as reseller this week']);
    expect(to(mailer, 'lena@example.com').map((m) => m.subject)).not.toContain('Ruth: your mutual action plan this week');
    value(await saveMapNotifySettings(deps, owner, { mapId: acme.mapId, settings: { dueSoonDays: 3, partnerDigest: true, partnerAlerts: 'instant' } }));
    await runTick(notify, new Date('2026-11-09T07:30:00.000Z'));
    const copy = to(mailer, 'lena@example.com').find((m) => m.subject === 'Ruth: your mutual action plan this week')!;
    expect(copy.replyTo).toBe('ruth@example.com');
    expect(copy.text).not.toContain('/plans/');
  });

  it('never warns about an empty MAP, never calls it on track in the digest, and keeps no health on its row (owner, 2026-10-31)', async () => {
    const { deps, notify, mailer } = await setup();
    const globex = await addMap(deps, 'Globex');
    value(await changeMap(deps, owner, { mapId: globex.mapId, change: { kind: 'add', entity: 'exitTrigger', values: { condition: 'No deal', status: 'triggered' } } }));
    // Monday, weeks without a change for both MAPs: Acme slips, Globex has nothing to manage yet.
    await runTick(notify, new Date('2026-11-16T07:30:00.000Z'));
    const mine = to(mailer, 'ruth@example.com');
    expect(mine.filter((m) => /no progress/.test(m.subject)).map((m) => m.subject)).toEqual([expect.stringMatching(/^Acme as reseller: no progress/)]);
    const digest = mine.find((m) => /this week/.test(m.subject))!;
    expect(digest.text).toContain('Acme as reseller');
    expect(digest.text).not.toContain('Globex');
    const partners = value(await readPartners(deps, owner, { companyId })).value.partners;
    expect(partners.find((p) => p.id === globex.partnerId)).toMatchObject({ mapHealth: null, mapNextMilestone: null });
    // Inside the job only, an empty MAP counts as on track for momentum: stored silently, never warned about.
    const stored = (await deps.directory.jobMaps()).find((m) => m.mapId === globex.mapId)!;
    expect(stored.notify.momentumState).not.toBe('at_risk');
    expect(stored.notify.momentumState).not.toBe('off_track');
  });

  it('tells the owner what a person with a link changed, 15 minutes after, once', async () => {
    const { deps, notify, mailer, acme, lena, overdue } = await setup();
    const { token } = value(await shareMap(deps, owner, { mapId: acme.mapId, personId: lena }));
    const opened = await openMapLink(deps, token);
    if (opened.kind !== 'session') throw new Error('setup');
    const session = await resolveMapSession(deps, opened.sessionToken, acme.mapId);
    if (session.kind !== 'active') throw new Error('setup');
    const at = (iso: string) => ({ ...deps, clock: () => iso }) as Deps;
    const change: MapChange = { kind: 'update', entity: 'activity', id: overdue, patch: { status: 'done' } };
    value(await changeMap(at('2026-11-03T09:00:00.000Z'), session.actor, { mapId: acme.mapId, change }));
    expect(await runTick(notify, new Date('2026-11-03T09:10:00.000Z'))).toMatchObject({ read: 0 });
    await runTick(notify, new Date('2026-11-03T09:16:00.000Z'));
    const alerts = to(mailer, 'ruth@example.com');
    expect(alerts.map((m) => m.subject)).toEqual(['Changes to your MAP with Acme as reseller']);
    expect(alerts[0]!.text).toContain('Lena Ortiz marked “Book the kickoff” done');
    await runTick(notify, new Date('2026-11-03T09:31:00.000Z'));
    expect(to(mailer, 'ruth@example.com')).toHaveLength(1);
  });
});

describe('runTick on a company server: emails to every member who has them on (plan 15)', () => {
  /** The same MAP, owned by a company server's workspace: Anna (admin) and Ben (partner manager) get our side's emails. */
  async function teamSetup() {
    const s = await setup();
    const team = {
      userId: 'u1', name: 'Halden', email: null, team: true,
      recipients: [{ name: 'Anna', email: 'anna@halden.example' }, { name: 'Ben', email: 'ben@halden.example' }],
    };
    s.notify.owner = async (userId) => (userId === 'u1' ? { contact: team, deps: s.deps } : null);
    return s;
  }

  it('sends Monday’s digest to each, but not to one who turned it off; each has their own “sent once”', async () => {
    const { notify, mailer } = await teamSetup();
    await notify.prefs.unsubscribe(addressHash('ben@halden.example'), 'digest', TEST_NOW);
    await runTick(notify, new Date('2026-11-02T07:30:00.000Z'));
    expect(to(mailer, 'anna@halden.example').map((m) => m.subject)).toEqual(['Your MAP with Acme as reseller this week']);
    expect(to(mailer, 'ben@halden.example').map((m) => m.subject)).not.toContain('Your MAP with Acme as reseller this week');
    // Ben turns it on again: next Monday both get it, once each.
    await notify.prefs.resubscribe(addressHash('ben@halden.example'), 'digest');
    await runTick(notify, new Date('2026-11-09T07:30:00.000Z'));
    await runTick(notify, new Date('2026-11-09T07:45:00.000Z'));
    expect(to(mailer, 'anna@halden.example').filter((m) => /this week/.test(m.subject))).toHaveLength(2);
    expect(to(mailer, 'ben@halden.example').filter((m) => /this week/.test(m.subject))).toHaveLength(1);
  });

  it('warns each of them once when the MAP slips', async () => {
    const { notify, mailer } = await teamSetup();
    await runTick(notify, new Date('2026-11-12T07:30:00.000Z'));
    await runTick(notify, new Date('2026-11-13T07:30:00.000Z'));
    for (const address of ['anna@halden.example', 'ben@halden.example']) {
      expect(to(mailer, address).filter((m) => /no progress/.test(m.subject))).toHaveLength(1);
    }
  });

  it('when one member’s address keeps failing, the others get each warning once and the MAP’s state still moves on', async () => {
    const { notify, mailer, logged } = await teamSetup();
    const real = mailer.send.bind(mailer);
    notify.mailer = { send: async (message) => (message.to === 'ben@halden.example' ? { ok: false as const } : real(message)) };
    await runTick(notify, new Date('2026-11-12T07:30:00.000Z'));
    await runTick(notify, new Date('2026-11-12T07:45:00.000Z'));
    await runTick(notify, new Date('2026-11-13T07:30:00.000Z'));
    expect(to(mailer, 'anna@halden.example').filter((m) => /no progress/.test(m.subject))).toHaveLength(1);
    expect(to(mailer, 'ben@halden.example')).toEqual([]);
    expect(logged.some(([event]) => /failed/.test(event))).toBe(true);
  });

  it('a reminder to a MAP person and the partner’s weekly copy carry no reply-to: no one person speaks for the company', async () => {
    const { deps, notify, mailer, acme } = await teamSetup();
    await runTick(notify, TUE_0830);
    expect(to(mailer, 'ben@example.com')[0]!.replyTo).toBeUndefined();
    value(await saveMapNotifySettings(deps, owner, { mapId: acme.mapId, settings: { dueSoonDays: 3, partnerDigest: true, partnerAlerts: 'instant' } }));
    await runTick(notify, new Date('2026-11-09T07:30:00.000Z'));
    const copy = to(mailer, 'lena@example.com').find((m) => /your mutual action plan this week/.test(m.subject))!;
    expect(copy.subject).toBe('Halden: your mutual action plan this week');
    expect(copy.replyTo).toBeUndefined();
  });
});

describe('runTick after the partner type’s exit (ruling R7)', () => {
  /** Monday 16 November 2026, 08:30 in Berlin: both activities overdue, 19 days without progress, and digest day. */
  const MON_1116 = new Date('2026-11-16T07:30:00.000Z');

  async function withPartnerCopy(exit: boolean) {
    const s = await setup();
    value(await saveMapNotifySettings(s.deps, owner, { mapId: s.acme.mapId, settings: { dueSoonDays: 3, partnerDigest: true, partnerAlerts: 'off' } }));
    if (exit) {
      const { partnerId } = s.acme;
      value(await changePartner(s.deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-10-28' } }));
      value(await changePartner(s.deps, owner, { companyId, change: { kind: 'markExited', partnerId, exitedDate: '2026-10-29', reason: 'Moved on' } }));
    }
    return s;
  }

  it('sends no reminders, no momentum warning and no partner copy; the refresh runs and the owner’s digest still lists it', async () => {
    const running = await withPartnerCopy(false);
    await runTick(running.notify, MON_1116);
    expect(running.mailer.outbox.map((m) => [m.to, m.subject])).toEqual(expect.arrayContaining([
      ['ben@example.com', 'Overdue: Send the pricing sheet'],
      ['lena@example.com', 'Overdue: Book the kickoff'],
      ['ruth@example.com', 'Acme as reseller: no progress for 19 days'],
      ['lena@example.com', 'Ruth: your mutual action plan this week'],
    ]));

    const ended = await withPartnerCopy(true);
    expect(await runTick(ended.notify, MON_1116)).toMatchObject({ maps: 1, read: 1, failed: 0 });
    expect(ended.mailer.outbox.map((m) => [m.to, m.subject])).toEqual([['ruth@example.com', 'Your MAP with Acme as reseller this week']]);
    // Its momentum is kept as on track, so no warning goes out later either.
    expect((await ended.deps.directory.mapNotifyState(ended.acme.mapId))!.momentumState).toBe('on_track');
    await runTick(ended.notify, new Date('2026-11-17T07:30:00.000Z'));
    expect(ended.mailer.outbox).toHaveLength(1);
  });

  it('keeps refreshing the partner row’s MAP health after the exit', async () => {
    const { deps, notify, acme } = await withPartnerCopy(true);
    const row = async () => value(await readPartners(deps, owner, { companyId })).value.partners.find((p) => p.id === acme.partnerId)!;
    await deps.partnerBooks.apply(
      { fileId: (await deps.directory.partnerBook(companyId))!.fileId },
      { kind: 'setMapSummary', partnerId: acme.partnerId, health: null, nextMilestone: null },
      { now: TEST_NOW, actor: 'Hand' },
    );
    expect(await row()).toMatchObject({ stage: 'exit', mapHealth: null });
    expect(await runTick({ ...notify, mailer: null }, MON_1116)).toMatchObject({ read: 1, refreshed: 1 });
    expect((await row()).mapHealth).not.toBeNull();
  });
});

describe('the owner’s Google access broken', () => {
  it('pauses the MAP, sends one Reconnect email, and the paused MAP waits', async () => {
    const { deps, notify, mailer, acme, logged } = await setup();
    deps.maps.read = async () => ({ ok: false, error: 'auth', message: 'Reconnect' });
    expect(await runTick(notify, TUE_0830)).toMatchObject({ paused: 1, sent: 0 });
    expect(mailer.outbox.map((m) => [m.to, m.subject])).toEqual([['ruth@example.com', 'Reconnect your Google account to keep your MAPs running']]);
    expect((await deps.directory.mapNotifyState(acme.mapId))!.pausedReason).toBe('auth');
    expect(logged).toContainEqual(['map_paused_auth', { mapId: acme.mapId }]);
    expect(await runTick(notify, TUE_0845)).toMatchObject({ maps: 0, read: 0 });
    // A link holder's failed save the same day: no second email.
    await pauseForAuth(notify, acme.mapId, TUE_0845);
    expect(mailer.outbox).toHaveLength(1);
  });
});

describe('runCleanup', () => {
  it('runs in the first quarter of each hour and keeps going when a step fails', async () => {
    expect(shouldClean(new Date('2026-11-03T07:05:00.000Z'))).toBe(true);
    expect(shouldClean(new Date('2026-11-03T07:20:00.000Z'))).toBe(false);
    const log = vi.fn();
    const prune = vi.fn(async () => ({ deliveries: 5, marks: 6 }));
    const result = await runCleanup({
      sessions: { deleteExpired: async () => 2 }, rateLimits: { prune: async () => { throw new Error('x'); } },
      dedupe: { prune: async () => 3 }, mapEvents: { prune: async () => 4 }, webhooks: { prune },
      proposals: { expire: async () => 7, prune: async () => 8 }, verifications: { pruneExpired: async () => 9 }, invites: { pruneExpired: async () => 10 }, log,
    }, TUE_0830);
    expect(result).toEqual({
      sessions: 2, rateLimits: 0, notifications: 3, mapEvents: 4, webhookDeliveries: 5, webhookMarks: 6, proposalsExpired: 7, proposalsPruned: 8,
      verifications: 9, invites: 10,
    });
    expect(log).toHaveBeenCalledWith('cleanup_step_failed', { step: 'rate_limits' });
    // The webhook queue is pruned by its own rules (7 days for deliveries, 90 for marks), from the clean-up's time.
    expect(prune).toHaveBeenCalledWith(TUE_0830.getTime());
  });

  it('counts the webhook queue as 0 when its pruning fails, and still runs the rest', async () => {
    const log = vi.fn();
    const result = await runCleanup({
      sessions: { deleteExpired: async () => 2 }, rateLimits: { prune: async () => 1 }, dedupe: { prune: async () => 3 },
      mapEvents: { prune: async () => 4 }, webhooks: { prune: async () => { throw new Error('webhooks_prune_failed'); } },
      proposals: { expire: async () => 0, prune: async () => 0 }, verifications: { pruneExpired: async () => { throw new Error('verification_prune_failed'); } },
      invites: { pruneExpired: async () => { throw new Error('invite_prune_failed'); } }, log,
    }, TUE_0830);
    expect(result).toEqual({
      sessions: 2, rateLimits: 1, notifications: 3, mapEvents: 4, webhookDeliveries: 0, webhookMarks: 0, proposalsExpired: 0, proposalsPruned: 0,
      verifications: 0, invites: 0,
    });
    expect(log).toHaveBeenCalledWith('cleanup_step_failed', { step: 'webhooks' });
  });

  it('runCleanup expires and prunes proposals, and a failing step counts 0', async () => {
    const base = {
      sessions: { deleteExpired: async () => 0 }, rateLimits: { prune: async () => 0 }, dedupe: { prune: async () => 0 },
      mapEvents: { prune: async () => 0 }, webhooks: { prune: async () => ({ deliveries: 0, marks: 0 }) },
      verifications: { pruneExpired: async () => 0 }, invites: { pruneExpired: async () => 0 },
    };
    const calls: string[] = [];
    const expire = vi.fn(async (now: string) => { calls.push(`expire ${now}`); return 2; });
    const prune = vi.fn(async (before: string) => { calls.push(`prune ${before}`); return 3; });
    const result = await runCleanup({ ...base, proposals: { expire, prune }, log: vi.fn() }, TUE_0830);
    expect(result).toMatchObject({ proposalsExpired: 2, proposalsPruned: 3 });
    // Expired first, as of now; then rows answered more than 90 days ago go (an expired one counts from its expiry).
    expect(calls).toEqual(['expire 2026-11-03T07:30:00.000Z', 'prune 2026-08-05T07:30:00.000Z']);

    const log = vi.fn();
    const failing = await runCleanup({
      ...base, proposals: { expire: async () => { throw new Error('proposals_expire_failed'); }, prune: async () => 3 }, log,
    }, TUE_0830);
    expect(failing).toMatchObject({ proposalsExpired: 0, proposalsPruned: 3 });
    expect(log).toHaveBeenCalledWith('cleanup_step_failed', { step: 'proposals_expire' });
    const failingPrune = await runCleanup({
      ...base, proposals: { expire: async () => 1, prune: async () => { throw new Error('proposals_prune_failed'); } }, log,
    }, TUE_0830);
    expect(failingPrune).toMatchObject({ proposalsExpired: 1, proposalsPruned: 0 });
    expect(log).toHaveBeenCalledWith('cleanup_step_failed', { step: 'proposals_prune' });
  });
});

describe('runTick: webhooks (agents spec 7.2)', () => {
  type Setup = Awaited<ReturnType<typeof setup>>;
  const subscribe = async (s: Setup, events: WebhookEvent[]) => s.deps.webhooks.create({ userId: 'u1', url: 'https://hooks.example.com/in', events });
  const sentOf = (s: Setup, type: string) => s.deps.webhooks.deliveries.filter((d) => d.type === type).map((d) => d.data);
  const at = (date: string) => new Date(`${date}T07:30:00.000Z`);

  it('an overdue activity sends activity.overdue once, not again on the next tick', async () => {
    const s = await setup();
    await subscribe(s, ['activity.overdue']);
    await runTick(s.notify, TUE_0830);
    expect(sentOf(s, 'activity.overdue')).toEqual([{ mapId: s.acme.mapId, partnerId: s.acme.partnerId, activityId: s.overdue }]);
    // A second run the same morning, and the next day (the other activity is due that day: not overdue yet).
    await runTick(s.notify, TUE_0845);
    await runTick(s.notify, at('2026-11-04'));
    expect(sentOf(s, 'activity.overdue')).toHaveLength(1);
    // The day after its due date, the other one goes too.
    await runTick(s.notify, at('2026-11-05'));
    expect(sentOf(s, 'activity.overdue').map((d) => d.activityId)).toEqual([s.overdue, s.soon]);
  });

  it('an activity done, then reopened with the same due date, doesn’t send again', async () => {
    const s = await setup();
    await subscribe(s, ['activity.overdue']);
    await runTick(s.notify, TUE_0830);
    const status = async (next: 'done' | 'in_progress') =>
      value(await changeMap(s.deps, owner, { mapId: s.acme.mapId, change: { kind: 'update', entity: 'activity', id: s.overdue, patch: { status: next } } }));
    await status('done');
    await runTick(s.notify, at('2026-11-04'));
    await status('in_progress');
    await runTick(s.notify, at('2026-11-05'));
    expect(sentOf(s, 'activity.overdue').filter((d) => d.activityId === s.overdue)).toHaveLength(1);
  });

  it('moving the due date and passing it again sends a second one', async () => {
    const s = await setup();
    await subscribe(s, ['activity.overdue']);
    await runTick(s.notify, TUE_0830);
    value(await changeMap(s.deps, owner, { mapId: s.acme.mapId, change: { kind: 'update', entity: 'activity', id: s.overdue, patch: { dueDate: '2026-11-05' } } }));
    await runTick(s.notify, at('2026-11-05'));
    expect(sentOf(s, 'activity.overdue').filter((d) => d.activityId === s.overdue)).toHaveLength(1);
    await runTick(s.notify, at('2026-11-06'));
    expect(sentOf(s, 'activity.overdue').filter((d) => d.activityId === s.overdue)).toHaveLength(2);
  });

  it('sends nothing for an activity more than 30 days late, so a mark pruned after 90 days never sends twice', async () => {
    const s = await setup();
    await subscribe(s, ['activity.overdue']);
    // Book the kickoff was due 1 November: 31 days late on 2 December, when Send the pricing sheet (due 4 November) is 28.
    await runTick(s.notify, at('2026-12-02'));
    expect(sentOf(s, 'activity.overdue').map((d) => d.activityId)).toEqual([s.soon]);
    // Its mark gone (the clean-up, 90 days on), it is still not sent again.
    s.deps.webhooks.marks.clear();
    await runTick(s.notify, at('2027-03-05'));
    expect(sentOf(s, 'activity.overdue')).toHaveLength(1);
    expect(LATE_WINDOW_DAYS * 24 * 60 * 60_000).toBeLessThan(MARK_KEEP_MS);
  });

  it('sends nothing for an activity done, or after the partner type’s exit', async () => {
    const s = await setup();
    await subscribe(s, ['activity.overdue']);
    value(await changeMap(s.deps, owner, { mapId: s.acme.mapId, change: { kind: 'update', entity: 'activity', id: s.overdue, patch: { status: 'done' } } }));
    await runTick(s.notify, TUE_0830);
    expect(sentOf(s, 'activity.overdue')).toEqual([]);
    const { partnerId } = s.acme;
    value(await changePartner(s.deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-10-28' } }));
    value(await changePartner(s.deps, owner, { companyId, change: { kind: 'markExited', partnerId, exitedDate: '2026-10-29', reason: 'Moved on' } }));
    await runTick(s.notify, at('2026-11-10'));
    expect(sentOf(s, 'activity.overdue')).toEqual([]);
  });

  it('health on_track to at_risk sends health.changed once; the same health next day sends none', async () => {
    const s = await setup();
    await subscribe(s, ['health.changed']);
    // The first health the webhooks hear of is kept, not sent: nothing changed.
    await runTick(s.notify, TUE_0830);
    expect(sentOf(s, 'health.changed')).toEqual([]);
    expect((await s.deps.directory.mapNotifyState(s.acme.mapId))!.webhookHealth).toBe('on_track');
    // 15 days without progress: at risk.
    await runTick(s.notify, at('2026-11-12'));
    expect(sentOf(s, 'health.changed')).toEqual([{ mapId: s.acme.mapId, partnerId: s.acme.partnerId }]);
    expect((await s.deps.directory.mapNotifyState(s.acme.mapId))!.webhookHealth).toBe('at_risk');
    await runTick(s.notify, at('2026-11-13'));
    expect(sentOf(s, 'health.changed')).toHaveLength(1);
  });

  it('an empty MAP has no health and sends nothing', async () => {
    const s = await setup();
    await subscribe(s, ['health.changed']);
    const globex = await addMap(s.deps, 'Globex');
    await runTick(s.notify, TUE_0830);
    await runTick(s.notify, at('2026-12-22'));
    expect(sentOf(s, 'health.changed').map((d) => d.mapId)).toEqual([s.acme.mapId]);
    expect((await s.deps.directory.mapNotifyState(globex.mapId))!.webhookHealth).toBeNull();
  });

  it('a review within 21 days sends review.due once per horizon', async () => {
    const s = await setup();
    await subscribe(s, ['review.due']);
    const { mapId, partnerId } = s.acme;
    value(await changePartner(s.deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-10-28' } }));
    const reviewOn = async (date: string) =>
      value(await changeMap(s.deps, owner, { mapId, change: { kind: 'updateInfo', patch: { nextReviewDate: date } } }));
    await reviewOn('2026-11-30');
    // 27 days ahead: not yet.
    await runTick(s.notify, TUE_0830);
    expect(sentOf(s, 'review.due')).toEqual([]);
    await reviewOn('2026-11-20');
    await runTick(s.notify, at('2026-11-04'));
    expect(sentOf(s, 'review.due')).toEqual([{ mapId, partnerId }]);
    await runTick(s.notify, at('2026-11-05'));
    expect(sentOf(s, 'review.due')).toHaveLength(1);
    // A moved review comes up again.
    await reviewOn('2026-11-24');
    await runTick(s.notify, at('2026-11-06'));
    expect(sentOf(s, 'review.due')).toHaveLength(2);
    // A review not held stays due for 30 days after its date, then sends nothing more, its mark pruned or not.
    await reviewOn('2026-10-20');
    await runTick(s.notify, at('2026-11-20'));
    expect(sentOf(s, 'review.due')).toHaveLength(2);
  });

  /** The webhook as if added, or turned on, at `iso`: its overdue and review events count from that day on. */
  const addedAt = (s: Setup, id: string, iso: string) => { s.deps.webhooks.rows.find((r) => r.id === id)!.createdAt = iso; };
  const sentTo = (s: Setup, type: string) => s.deps.webhooks.deliveries.filter((d) => d.type === type).map((d) => [d.webhookId, d.data.activityId ?? d.data.mapId]);

  it('a webhook added after an activity turned late doesn’t hear of it; one that turns late later goes', async () => {
    const s = await setup();
    const { webhook } = await subscribe(s, ['activity.overdue']);
    // 07:00 on 3 November in Berlin. Book the kickoff (due 1 November) turned late on the 2nd: before it.
    addedAt(s, webhook.id, '2026-11-03T06:00:00.000Z');
    await runTick(s.notify, TUE_0830);
    expect(sentOf(s, 'activity.overdue')).toEqual([]);
    // No mark either: nothing is spent on an event no webhook got.
    expect(s.deps.webhooks.marks.size).toBe(0);
    // Send the pricing sheet (due 4 November) turns late on the 5th, after it.
    await runTick(s.notify, at('2026-11-05'));
    expect(sentOf(s, 'activity.overdue')).toEqual([{ mapId: s.acme.mapId, partnerId: s.acme.partnerId, activityId: s.soon }]);
  });

  it('counts "after it was added" in the owner’s own date: an owner in Auckland', async () => {
    const s = await setup();
    const auckland = { ...s.notify, timeZoneOf: async () => 'Pacific/Auckland' };
    const add = (title: string, dueDate: string) => s.acme.add('activity', { title, side: 'us', ownerId: s.ben, dueDate });
    const dueSecond = await add('Share the price list', '2026-11-02');
    const dueThird = await add('Send the logo', '2026-11-03');
    const { webhook } = await subscribe(s, ['activity.overdue']);
    // 01:00 on 4 November in Auckland, still 3 November in UTC.
    addedAt(s, webhook.id, '2026-11-03T12:00:00.000Z');
    // 08:00 on 4 November in Auckland. Due 2 November: late on the 3rd, before the webhook. Due 3 November: late on
    // the 4th, the webhook's own day.
    await runTick(auckland, new Date('2026-11-03T19:00:00.000Z'));
    expect(sentOf(s, 'activity.overdue').map((d) => d.activityId)).toEqual([dueThird]);
    expect(sentOf(s, 'activity.overdue').map((d) => d.activityId)).not.toContain(dueSecond);
  });

  it('two webhooks: only the older hears of what turned late between them; both hear of the next', async () => {
    const s = await setup();
    const older = (await subscribe(s, ['activity.overdue'])).webhook;
    const newer = (await subscribe(s, ['activity.overdue'])).webhook;
    addedAt(s, newer.id, '2026-11-03T06:00:00.000Z');
    await runTick(s.notify, TUE_0830);
    expect(sentTo(s, 'activity.overdue')).toEqual([[older.id, s.overdue]]);
    await runTick(s.notify, at('2026-11-05'));
    expect(sentTo(s, 'activity.overdue')).toEqual([[older.id, s.overdue], [older.id, s.soon], [newer.id, s.soon]]);
    // One event, one id, for both.
    const [, a, b] = s.deps.webhooks.deliveries;
    expect(a!.id).toBe(b!.id);
  });

  it('a review already within 21 days when the webhook is added sends nothing; a review that comes up later does', async () => {
    const s = await setup();
    const { webhook } = await subscribe(s, ['review.due']);
    const { mapId, partnerId } = s.acme;
    value(await changePartner(s.deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-10-28' } }));
    const reviewOn = async (date: string) =>
      value(await changeMap(s.deps, owner, { mapId, change: { kind: 'updateInfo', patch: { nextReviewDate: date } } }));
    // Coming since 30 October, before the webhook (3 November).
    await reviewOn('2026-11-20');
    addedAt(s, webhook.id, '2026-11-03T06:00:00.000Z');
    await runTick(s.notify, TUE_0830);
    await runTick(s.notify, at('2026-11-04'));
    expect(sentOf(s, 'review.due')).toEqual([]);
    expect(s.deps.webhooks.marks.size).toBe(0);
    // Moved to 30 November: it comes within 21 days on 9 November, after the webhook.
    await reviewOn('2026-11-30');
    await runTick(s.notify, at('2026-11-08'));
    expect(sentOf(s, 'review.due')).toEqual([]);
    await runTick(s.notify, at('2026-11-09'));
    expect(sentOf(s, 'review.due')).toEqual([{ mapId, partnerId }]);
  });

  it('a webhook turned on again hears only of what happens after', async () => {
    const s = await setup();
    const { webhook } = await subscribe(s, ['activity.overdue']);
    await s.deps.webhooks.setStatus('u1', webhook.id, 'off');
    await s.deps.webhooks.setStatus('u1', webhook.id, 'active');
    // Turned on again at 07:00 on 3 November in Berlin; added on 28 October, while Book the kickoff was not late yet.
    s.deps.webhooks.rows.find((r) => r.id === webhook.id)!.turnedOnAt = '2026-11-03T06:00:00.000Z';
    await runTick(s.notify, TUE_0830);
    expect(sentOf(s, 'activity.overdue')).toEqual([]);
    await runTick(s.notify, at('2026-11-05'));
    expect(sentOf(s, 'activity.overdue').map((d) => d.activityId)).toEqual([s.soon]);
  });

  it('an empty MAP keeps the health last heard of: back to the same health sends nothing, to another sends one', async () => {
    const s = await setup();
    await subscribe(s, ['health.changed']);
    const { mapId } = s.acme;
    const health = async () => (await s.deps.directory.mapNotifyState(mapId))!.webhookHealth;
    await runTick(s.notify, TUE_0830);
    expect(await health()).toBe('on_track');
    // Every row removed: no health, and the one heard of is kept.
    for (const id of [s.soon, s.overdue]) value(await changeMap(s.deps, owner, { mapId, change: { kind: 'delete', entity: 'activity', id } }));
    await runTick(s.notify, at('2026-11-04'));
    expect(await health()).toBe('on_track');
    expect(sentOf(s, 'health.changed')).toEqual([]);
    // Rows back, on track: the same health, nothing to tell.
    value(await changeMap(s.deps, owner, { mapId, change: { kind: 'add', entity: 'activity', values: { title: 'Plan the launch', side: 'us', ownerId: s.ben, dueDate: '2026-11-20' } } }));
    await runTick(s.notify, at('2026-11-05'));
    expect(sentOf(s, 'health.changed')).toEqual([]);
    expect(await health()).toBe('on_track');
    // 15 days without progress: at risk, one message.
    await runTick(s.notify, at('2026-11-12'));
    expect(sentOf(s, 'health.changed')).toEqual([{ mapId, partnerId: s.acme.partnerId }]);
    expect(await health()).toBe('at_risk');
  });

  it('an owner without webhooks costs no extra Google reads and one look at their webhooks per run', async () => {
    const counted = async (events: WebhookEvent[] | null) => {
      const s = await setup();
      if (events) await subscribe(s, events);
      const google = { maps: vi.spyOn(s.deps.maps, 'read'), partners: vi.spyOn(s.deps.partnerBooks, 'read') };
      const store = {
        subscriptions: vi.spyOn(s.deps.webhooks, 'subscriptions'), enqueue: vi.spyOn(s.deps.webhooks, 'enqueue'),
        health: vi.spyOn(s.deps.directory, 'setMapWebhookHealth'),
      };
      await runTick(s.notify, TUE_0830);
      return {
        google: google.maps.mock.calls.length + google.partners.mock.calls.length,
        subscriptions: store.subscriptions.mock.calls.length, enqueue: store.enqueue.mock.calls.length, health: store.health.mock.calls.length,
      };
    };
    const without = await counted(null);
    const off = await counted(['partner.signed']);
    const all = await counted(['activity.overdue', 'health.changed', 'review.due']);
    // One look at the owner's webhooks per run; nothing queued, nothing stored, and Google read as often as with webhooks.
    expect(without).toEqual({ google: all.google, subscriptions: 1, enqueue: 0, health: 0 });
    expect(off).toEqual({ google: all.google, subscriptions: 1, enqueue: 0, health: 0 });
    expect(all).toMatchObject({ subscriptions: 1, enqueue: 1, health: 1 });
  });

  it('a webhook turned off counts as none, and the health it last heard of is forgotten', async () => {
    const s = await setup();
    const { webhook } = await subscribe(s, ['health.changed', 'activity.overdue']);
    await runTick(s.notify, TUE_0830);
    expect((await s.deps.directory.mapNotifyState(s.acme.mapId))!.webhookHealth).toBe('on_track');
    expect(sentOf(s, 'activity.overdue')).toHaveLength(1);
    await s.deps.webhooks.setStatus('u1', webhook.id, 'off');
    await runTick(s.notify, at('2026-11-12'));
    expect(sentOf(s, 'health.changed')).toEqual([]);
    expect(sentOf(s, 'activity.overdue')).toHaveLength(1);
    expect((await s.deps.directory.mapNotifyState(s.acme.mapId))!.webhookHealth).toBeNull();
  });

  it('Turn on forgets the health heard of before: a change while the webhook was off sends no health.changed', async () => {
    const s = await setup();
    const { webhook } = await subscribe(s, ['health.changed']);
    const health = async () => (await s.deps.directory.mapNotifyState(s.acme.mapId))!.webhookHealth;
    await runTick(s.notify, TUE_0830);
    expect(await health()).toBe('on_track');
    // Off and on again between two runs: no run saw it off, so the run alone would tell of on_track to at_risk.
    value(await turnOffWebhook(s.deps, owner, { webhookId: webhook.id }));
    value(await turnOnWebhook(s.deps, owner, { webhookId: webhook.id }));
    expect(await health()).toBeNull();
    await runTick(s.notify, at('2026-11-12'));
    // As for a new webhook: the first health after Turn on is stored, not sent.
    expect(sentOf(s, 'health.changed')).toEqual([]);
    expect(await health()).toBe('at_risk');
    await runTick(s.notify, at('2026-11-13'));
    expect(sentOf(s, 'health.changed')).toEqual([]);
  });

  it('Turn on keeps the health heard of when nothing was off, or another webhook on still hears of health', async () => {
    const s = await setup();
    const { webhook } = await subscribe(s, ['health.changed']);
    const health = async () => (await s.deps.directory.mapNotifyState(s.acme.mapId))!.webhookHealth;
    await runTick(s.notify, TUE_0830);
    // On already: Turn on changes nothing.
    value(await turnOnWebhook(s.deps, owner, { webhookId: webhook.id }));
    expect(await health()).toBe('on_track');
    // A second webhook off and on while the first stays on: the first kept the stored health current, so it stays.
    const { webhook: second } = await subscribe(s, ['health.changed']);
    value(await turnOffWebhook(s.deps, owner, { webhookId: second.id }));
    value(await turnOnWebhook(s.deps, owner, { webhookId: second.id }));
    expect(await health()).toBe('on_track');
    await runTick(s.notify, at('2026-11-12'));
    expect(sentOf(s, 'health.changed')).toHaveLength(2);
  });

  it('a webhook without health.changed turned on leaves the stored health alone', async () => {
    const s = await setup();
    await subscribe(s, ['health.changed']);
    const { webhook: other } = await subscribe(s, ['partner.signed']);
    await runTick(s.notify, TUE_0830);
    value(await turnOffWebhook(s.deps, owner, { webhookId: other.id }));
    value(await turnOnWebhook(s.deps, owner, { webhookId: other.id }));
    expect((await s.deps.directory.mapNotifyState(s.acme.mapId))!.webhookHealth).toBe('on_track');
  });

  it('a failed enqueue never fails the tick or the emails, and is logged by ids only', async () => {
    const s = await setup();
    await subscribe(s, ['activity.overdue', 'health.changed']);
    s.deps.webhooks.enqueue = async () => { throw new Error('webhooks_enqueue_failed: https://hooks.example.com/in Book the kickoff'); };
    expect(await runTick(s.notify, TUE_0830)).toMatchObject({ read: 1, sent: 2, failed: 0 });
    expect(s.logged).toContainEqual(['webhook_enqueue_failed', { type: 'activity.overdue', userId: 'u1', mapId: s.acme.mapId }]);
    expect(JSON.stringify(s.logged)).not.toMatch(/hooks\.example|Book the kickoff|Acme/);
  });

  it('a failed look at the owner’s webhooks skips them, keeps the stored health, and the run goes on', async () => {
    const s = await setup();
    await subscribe(s, ['health.changed']);
    await runTick(s.notify, TUE_0830);
    s.deps.webhooks.subscriptions = async () => { throw new Error('webhooks_list_failed'); };
    expect(await runTick(s.notify, at('2026-11-12'))).toMatchObject({ read: 1, failed: 0 });
    expect(s.logged).toContainEqual(['webhook_list_failed', { userId: 'u1' }]);
    expect((await s.deps.directory.mapNotifyState(s.acme.mapId))!.webhookHealth).toBe('on_track');
  });

  it('delivers what is due with the time the run has left, and skips it when none is left', async () => {
    const s = await setup();
    let now = 0;
    const deliver = vi.fn(async () => ({ sent: 3, failed: 1, turnedOff: 1 }));
    // The reads take 12 seconds of the run's 50.
    const google = s.deps.maps.read.bind(s.deps.maps);
    s.deps.maps.read = async (...args) => { now += 12_000; return google(...args); };
    const result = await runTick({ ...s.notify, clock: () => now, deliverWebhooks: deliver }, TUE_0830);
    // 38 seconds left, less one delivery's longest (the address check's 5-second lookup, then the 10-second request)
    // and the clean-up's reserve.
    expect(deliver).toHaveBeenCalledWith(TUE_0830, 38_000 - RESOLVE_TIMEOUT_MS - REQUEST_TIMEOUT_MS - CLEANUP_RESERVE_MS);
    expect(result).toMatchObject({ webhooksSent: 3, webhooksFailed: 1, webhooksTurnedOff: 1 });
    deliver.mockClear();
    expect(await runTick({ ...s.notify, deadlineMs: 0, deliverWebhooks: deliver }, TUE_0845)).toMatchObject({ webhooksSent: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('the last send ends before the tick’s deadline, leaving the clean-up its reserve, when every lookup takes 5 seconds and every receiver 10', async () => {
    const s = await setup();
    let now = 0;
    let sends = 0;
    // A queue that always has one more due, to a receiver that never answers (the request's whole 10 seconds).
    const store = {
      claimDue: async (at: number) => [{
        id: `evt_${sends}`, webhookId: 'wh_1', userId: 'u1', url: 'https://down.example.com', secret: 'whsec_x', type: 'activity.overdue',
        data: {}, occurredAt: new Date(at).toISOString(), attempts: 0,
      }],
      markDone: async () => {}, markFailed: async (_d: unknown, { nowMs }: { nowMs: number }) => ({ firstFailureAt: nowMs }),
      turnOffFailing: async () => false,
    };
    const send = async () => { sends++; now += REQUEST_TIMEOUT_MS; return 0; };
    const deliverWebhooks = (at: Date, deadlineMs: number) =>
      deliverDue({
        store, send, checkTarget: async () => { now += RESOLVE_TIMEOUT_MS; return { ok: true }; }, clock: () => now, log: () => {},
      }, at, { deadlineMs });
    // A deadline that isn't a whole number of deliveries away, so a budget short of one delivery's longest shows.
    const deadlineMs = 46_000;
    const result = await runTick({ ...s.notify, clock: () => now, deadlineMs, deliverWebhooks }, TUE_0830);
    expect(sends).toBeGreaterThan(0);
    expect(result).toMatchObject({ webhooksFailed: sends });
    expect(now).toBeLessThanOrEqual(deadlineMs - CLEANUP_RESERVE_MS);
  });

  it('a throw in a MAP’s webhook work is logged by its id, and the digest still goes out', async () => {
    const s = await setup();
    await subscribe(s, ['health.changed', 'activity.overdue']);
    core.summarizeMapThrows = true;
    try {
      // Monday: the digest's day.
      expect(await runTick(s.notify, new Date('2026-11-02T07:30:00.000Z'))).toMatchObject({ read: 1, failed: 0 });
    } finally {
      core.summarizeMapThrows = false;
    }
    expect(to(s.mailer, 'ruth@example.com').map((m) => m.subject)).toContain('Your MAP with Acme as reseller this week');
    expect(s.logged).toContainEqual(['webhook_map_failed', { mapId: s.acme.mapId }]);
    expect(JSON.stringify(s.logged)).not.toContain('a rule broke');
  });

  it('a delivery run that throws is logged and the tick still answers', async () => {
    const s = await setup();
    const deliver = vi.fn(async () => { throw new Error('webhooks_due_failed'); });
    expect(await runTick({ ...s.notify, deliverWebhooks: deliver }, TUE_0830)).toMatchObject({ sent: 2, webhooksSent: 0 });
    expect(s.logged).toContainEqual(['webhook_delivery_run_failed', { error: 'Error' }]);
    expect(JSON.stringify(s.logged)).not.toContain('webhooks_due_failed');
  });

  it('the tick’s answer stays counts only', async () => {
    const s = await setup();
    await subscribe(s, ['activity.overdue', 'health.changed', 'review.due']);
    const result = await runTick({ ...s.notify, deliverWebhooks: async () => ({ sent: 1, failed: 0, turnedOff: 0 }) }, TUE_0830);
    for (const [key, v] of Object.entries(result)) {
      expect([key, typeof v === 'number' || typeof v === 'boolean' || v === null]).toEqual([key, true]);
    }
    expect(JSON.stringify(result)).not.toMatch(/map_|ptn_|wh_|evt_|u1|https?:/);
  });
});
