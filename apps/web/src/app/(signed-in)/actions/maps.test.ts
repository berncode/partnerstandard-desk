import { changeMap, changePartner, listMaps, readMap, readPartners, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cardOf } from '@/maps/view-model';
import type { OwnerSession } from '@/server/runtime';

const COMPANY = 'co_aaaaaaaaaa';
const state = vi.hoisted(() => ({
  session: null as OwnerSession | null, deps: null as unknown as ReturnType<typeof makeTestDeps>, mail: false,
  sent: [] as Array<{ to: { ownerUserId: string; mapId: string; personId: string; side: string; email: string }; token: string }>,
}));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  companyFor: async () => ({ companyId: COMPANY, name: 'Halden' }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
  mapLinkFor: (token: string) => `https://desk.test/c/${token}`,
  mailConfigured: () => state.mail,
  sendMapLink: async (to: { ownerUserId: string; mapId: string; personId: string; side: string; email: string }, token: string) => {
    state.sent.push({ to, token });
    return to.email !== 'bounce@example.com';
  },
}));

const {
  mapArea, mapChange, mapCount, mapDelete, mapFill, mapList, mapNotifyLoad, mapNotifySave, mapShareCopy, mapShareLoad, mapShareRevoke, mapShareSend, mapShiftDates, mapStart,
} = await import('./maps');

const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };
const SIGNED_OUT = { ok: false, error: 'auth', message: COPY.SIGNED_OUT };

/** Acme as a reseller: its partner type id. */
async function acme(): Promise<string> {
  const send = (change: unknown) => changePartner(state.deps, anna, { companyId: COMPANY, change });
  const account = await send({ kind: 'add', entity: 'account', values: { company: 'Acme' } });
  if (!account.ok || !account.value.entityId) throw new Error('setup');
  const reseller = await send({ kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'reseller' } });
  if (!reseller.ok || !reseller.value.entityId) throw new Error('setup');
  return reseller.value.entityId;
}

beforeEach(async () => {
  state.session = session;
  state.mail = false;
  state.sent = [];
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
  await readPartners(state.deps, anna, { companyId: COMPANY });
});

describe('mapStart, mapList and mapArea', () => {
  it('starts one MAP per partner type, lists it, and shows it in the area as read now', async () => {
    const partnerId = await acme();
    expect(await mapArea({ partnerId })).toEqual({ ok: true, state: { kind: 'none' } });
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    expect(await mapStart({ partnerId })).toMatchObject({ ok: false, error: 'invalid', message: COPY.MAP_ALREADY });
    expect(await mapList({ partnerId })).toMatchObject({ ok: true, maps: [{ mapId: started.mapId, displayName: 'Acme as reseller' }] });
    expect(await mapList(undefined)).toMatchObject({ ok: true, maps: [{ mapId: started.mapId }] });

    const added = await changeMap(state.deps, anna, {
      mapId: started.mapId, change: { kind: 'add', entity: 'milestone', values: { name: 'Day 30: Partner enabled', targetDate: '2099-01-30' } },
    });
    expect(added.ok).toBe(true);
    const shown = await mapArea({ partnerId });
    expect(shown).toMatchObject({
      ok: true,
      state: {
        kind: 'ready', mapId: started.mapId,
        card: { displayName: 'Acme as reseller', health: 'on_track', stage: 'recruitment', overdueCount: 0, nextMilestone: { name: 'Day 30: Partner enabled' } },
      },
    });
  });

  it('counts the MAPs from the directory alone, also with the Partners file gone', async () => {
    const partnerId = await acme();
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    vi.spyOn(state.deps.partnerBooks, 'read').mockResolvedValue({ ok: false, error: 'file_not_found', message: 'Gone.' });
    expect(await mapList({})).toMatchObject({ ok: false });
    expect(await mapCount({})).toEqual({ ok: true, count: 1 });
    expect(await mapCount({ partnerId: 'p_other' })).toEqual({ ok: true, count: 0 });
    vi.mocked(state.deps.partnerBooks.read).mockRestore();
  });

  it('keeps a MAP that can’t be read in the area, with what the partner row last kept and why', async () => {
    const partnerId = await acme();
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    expect((await changeMap(state.deps, anna, { mapId: started.mapId, change: { kind: 'add', entity: 'activity', values: { title: 'Kickoff', side: 'joint' } } })).ok).toBe(true);
    vi.spyOn(state.deps.maps, 'read').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'Not now.' });
    expect(await mapArea({ partnerId })).toMatchObject({
      ok: true, state: { kind: 'unread', mapId: started.mapId, displayName: 'Acme as reseller', health: 'on_track', nextMilestone: null, message: 'Not now.', deletable: true },
    });
  });

  it('deletes a MAP, also one whose file can’t be read, and the partner type can start a new one', async () => {
    const partnerId = await acme();
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    const entry = (await state.deps.directory.map(started.mapId))!;
    vi.spyOn(state.deps.maps, 'read').mockResolvedValue({ ok: false, error: 'file_not_found', message: 'Gone.' });
    const trash = vi.spyOn(state.deps.maps, 'trash');
    expect(await mapDelete({ mapId: started.mapId })).toEqual({ ok: true, mapId: started.mapId });
    expect(trash).toHaveBeenCalledWith({ fileId: entry.fileId });
    expect(await mapArea({ partnerId })).toEqual({ ok: true, state: { kind: 'none' } });
    expect(await mapDelete({ mapId: started.mapId })).toMatchObject({ ok: false, error: 'file_not_found', message: COPY.MAP_NOT_LISTED });
    vi.mocked(state.deps.maps.read).mockRestore();
    expect((await mapStart({ partnerId })).ok).toBe(true);
  });

  it('fills a new MAP from the guided steps, once', async () => {
    const partnerId = await acme();
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    const rows = {
      mapId: started.mapId, horizonDays: 90, objectives: [{ side: 'us', statement: 'Close three deals', successMeasure: '' }],
      people: [{ id: 'd_1', side: 'partner', name: 'Lena Ortiz', title: '', email: null, role: 'sales_lead' }],
      milestones: [], exitTriggers: [], activities: [{ title: 'Kickoff', category: 'other', side: 'partner', ownerId: 'd_1' }],
    };
    expect(await mapFill(rows)).toEqual({ ok: true, mapId: started.mapId });
    expect(await mapFill(rows)).toMatchObject({ ok: false, message: COPY.MAP_FILLED_ALREADY });
  });

  it('refuses malformed input and a company id, and answers signed out', async () => {
    expect(await mapArea({})).toMatchObject({ ok: false, error: 'invalid' });
    expect(await mapStart({ partnerId: 'p_1', companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await mapList({ companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await mapFill({ mapId: 'map_aaaaaaaaaa' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await mapDelete({ mapId: 'map_aaaaaaaaaa', companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await mapDelete({ mapId: 'map_aaaaaaaaaa' })).toEqual(SIGNED_OUT);
    expect(await mapStart({ partnerId: 'p_1' })).toEqual(SIGNED_OUT);
    expect(await mapArea({ partnerId: 'p_1' })).toEqual(SIGNED_OUT);
    expect(await mapList({})).toEqual(SIGNED_OUT);
    expect(await mapCount({})).toEqual(SIGNED_OUT);
    expect(await mapFill({})).toEqual(SIGNED_OUT);
  });
});

describe('one health for a MAP on every screen (ruling R6)', () => {
  const at = (day: string) => `2026-${day}T09:00:00.000Z`;

  /** The MAP's health and next milestone as the area, the Plans page's card and the partner row (the Partners list) give them. */
  async function everywhere(partnerId: string) {
    const area = await mapArea({ partnerId });
    if (!area.ok || area.state.kind !== 'ready') throw new Error('area');
    const today = state.deps.clock().slice(0, 10);
    const listed = await listMaps(state.deps, anna, { companyId: COMPANY });
    const item = listed.ok ? listed.value.find((m) => m.partnerId === partnerId) : undefined;
    const read = item && await readMap(state.deps, anna, { mapId: item.mapId });
    if (!item || !read?.ok) throw new Error('plans');
    const plans = cardOf(item, read.value, today);
    const book = await readPartners(state.deps, anna, { companyId: COMPANY });
    const row = book.ok ? book.value.value.partners.find((p) => p.id === partnerId) : undefined;
    return {
      area: { health: area.state.card.health, next: area.state.card.nextMilestone?.targetDate ?? null },
      plans: { health: plans.health, next: plans.nextMilestone?.targetDate ?? null },
      row: { health: row?.mapHealth ?? null, next: row?.mapNextMilestone ?? null },
    };
  }
  const agree = (seen: Awaited<ReturnType<typeof everywhere>>, expected: { health: string | null; next: string | null }) => {
    expect(seen.area).toEqual(expected);
    expect(seen.plans).toEqual(expected);
    expect(seen.row).toEqual(expected);
  };
  const send = (change: unknown) => changePartner(state.deps, anna, { companyId: COMPANY, change });

  it('a MAP stalled since its start, after a change to something other than an activity', async () => {
    const partnerId = await acme();
    state.deps.clock = () => at('09-01');
    expect((await send({ kind: 'markSigned', partnerId, signedDate: '2026-09-01' })).ok).toBe(true);
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    expect((await changeMap(state.deps, anna, { mapId: started.mapId, change: { kind: 'add', entity: 'activity', values: { title: 'Kickoff', side: 'joint' } } })).ok).toBe(true);
    state.deps.clock = () => at('10-20');
    expect((await changeMap(state.deps, anna, { mapId: started.mapId, change: { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Goal' } } })).ok).toBe(true);
    agree(await everywhere(partnerId), { health: 'on_track', next: null });
  });

  it('an empty MAP (owner, 2026-10-31): no health on the area and the card, none on the row; the list reads the directory', async () => {
    const partnerId = await acme();
    state.deps.clock = () => at('09-01');
    expect((await send({ kind: 'markSigned', partnerId, signedDate: '2026-09-01' })).ok).toBe(true);
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    state.deps.clock = () => at('10-20');
    // Objectives and exit triggers alone are nothing to manage: still empty, never at risk or off track.
    expect((await changeMap(state.deps, anna, { mapId: started.mapId, change: { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Goal' } } })).ok).toBe(true);
    expect((await changeMap(state.deps, anna, { mapId: started.mapId, change: { kind: 'add', entity: 'exitTrigger', values: { condition: 'No deal', status: 'triggered' } } })).ok).toBe(true);
    const seen = await everywhere(partnerId);
    expect(seen.area).toEqual({ health: 'empty', next: null });
    expect(seen.plans).toEqual({ health: 'empty', next: null });
    expect(seen.row).toEqual({ health: null, next: null });
    const listed = await listMaps(state.deps, anna, { companyId: COMPANY });
    expect(listed.ok && listed.value.map((m) => m.partnerId)).toEqual([partnerId]);
  });

  it('a recruitment closed without signing: "Not signed", and no next milestone', async () => {
    const partnerId = await acme();
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    const mapId = started.mapId;
    expect((await changeMap(state.deps, anna, { mapId, change: { kind: 'add', entity: 'milestone', values: { name: 'Day 30', targetDate: '2099-01-01' } } })).ok).toBe(true);
    expect((await send({ kind: 'close', partnerId, as: 'no', reason: 'Not a fit' })).ok).toBe(true);
    expect((await changeMap(state.deps, anna, { mapId, change: { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Goal' } } })).ok).toBe(true);
    agree(await everywhere(partnerId), { health: null, next: null });
  });

  it('a MAP whose only milestones are undated or planned for a day already past', async () => {
    const partnerId = await acme();
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    const add = (values: Record<string, unknown>) => changeMap(state.deps, anna, { mapId: started.mapId, change: { kind: 'add', entity: 'milestone', values } });
    expect((await add({ name: 'Undated' })).ok).toBe(true);
    expect((await add({ name: 'Planned, past', targetDate: '2026-01-02' })).ok).toBe(true);
    agree(await everywhere(partnerId), { health: 'on_track', next: null });
  });
});

describe('mapChange and mapShiftDates: the MAP page', () => {
  async function started(): Promise<{ mapId: string; partnerId: string }> {
    const partnerId = await acme();
    const out = await mapStart({ partnerId });
    if (!out.ok) throw new Error(out.message);
    return { mapId: out.mapId, partnerId };
  }

  it('saves a change and answers the MAP as its file holds it now, with the record, its start and its last progress', async () => {
    const { mapId } = await started();
    const out = await mapChange({ mapId, change: { kind: 'add', entity: 'activity', values: { title: 'Kickoff', side: 'joint' } } });
    if (!out.ok) throw new Error(out.message);
    expect(out.entityId).toMatch(/^a_/);
    expect(out.snapshot.value.activities.map((a) => a.title)).toEqual(['Kickoff']);
    expect(out.snapshot.record).toMatchObject({ partnerName: 'Acme', stage: 'recruitment', signedDate: null });
    const read = await readMap(state.deps, anna, { mapId });
    if (!read.ok) throw new Error(read.message);
    expect(out.snapshot.startedOn).toBe(read.value.startedOn);
    expect(out.snapshot.lastProgressAt).toBe(read.value.lastProgressAt);
  });

  it('answers a conflict with the MAP read again, so the page shows the latest version', async () => {
    const { mapId } = await started();
    const added = await mapChange({ mapId, change: { kind: 'add', entity: 'activity', values: { title: 'Kickoff', side: 'joint' } } });
    if (!added.ok) throw new Error(added.message);
    const id = added.entityId!;
    const seen = added.snapshot.value.activities[0]!.updatedAt;
    state.deps.clock = () => '2026-10-29T10:00:00.000Z';
    expect((await changeMap(state.deps, { ...anna, displayName: 'Lena' }, { mapId, change: { kind: 'update', entity: 'activity', id, patch: { status: 'blocked' } } })).ok).toBe(true);
    const out = await mapChange({ mapId, change: { kind: 'update', entity: 'activity', id, patch: { status: 'in_progress' }, expectedUpdatedAt: seen } });
    expect(out).toMatchObject({ ok: false, error: 'conflict', message: 'Updated by Lena since you opened it' });
    if (out.ok) throw new Error('expected a conflict');
    expect(out.snapshot?.value.activities[0]).toMatchObject({ id, status: 'blocked' });
  });

  it('reads nothing again when the same failure stands in the way, and refuses malformed input and a signed-out visit', async () => {
    const { mapId } = await started();
    vi.spyOn(state.deps.maps, 'apply').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'Not now.' });
    const read = vi.spyOn(state.deps.maps, 'read');
    expect(await mapChange({ mapId, change: { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Goal' } } }))
      .toEqual({ ok: false, error: 'unavailable', message: 'Not now.' });
    expect(read).not.toHaveBeenCalled();
    expect(await mapChange({ mapId, change: { kind: 'nope' } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await mapChange({ mapId, change: {}, extra: 1 })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await mapChange({ mapId, change: { kind: 'updateInfo', patch: {} } })).toEqual(SIGNED_OUT);
    expect(await mapShiftDates({ mapId })).toEqual(SIGNED_OUT);
  });

  it('moves the open dates for the signing once, and refuses before signing', async () => {
    const { mapId, partnerId } = await started();
    expect(await mapShiftDates({ mapId })).toMatchObject({ ok: false, message: COPY.MAP_DATES_NOT_SIGNED });
    expect((await changePartner(state.deps, anna, { companyId: COMPANY, change: { kind: 'markSigned', partnerId, signedDate: '2026-12-01' } })).ok).toBe(true);
    expect(await mapShiftDates({ mapId })).toMatchObject({ ok: true });
    expect(await mapShiftDates({ mapId })).toMatchObject({ ok: false, message: COPY.MAP_DATES_MOVED_ALREADY });
  });
});

describe('Share: mapShareLoad, mapShareCopy and mapShareRevoke', () => {
  async function shared() {
    const partnerId = await acme();
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    const { mapId } = started;
    const person = async (values: Record<string, unknown>) => {
      const out = await changeMap(state.deps, anna, { mapId, change: { kind: 'add', entity: 'person', values } });
      if (!out.ok) throw new Error(out.message);
      return out.value.entityId!;
    };
    const lena = await person({ side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'other' });
    const quiet = await person({ side: 'us', name: 'Quiet', title: '', email: null, role: 'other' });
    return { mapId, lena, quiet };
  }

  it('lists who can get a link, says email isn’t set up, and copies a link on APP_URL', async () => {
    const { mapId, lena } = await shared();
    expect(await mapShareLoad({ mapId })).toEqual({
      ok: true, mailConfigured: false,
      people: [{ personId: lena, name: 'Lena Ortiz', side: 'partner', email: 'lena@example.com', lastUsedAt: null, active: false, inPlan: true }],
    });
    const copied = await mapShareCopy({ mapId, personId: lena });
    expect(copied).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/desk\.test\/c\/[A-Za-z0-9_-]{43}$/) });
    expect(await mapShareLoad({ mapId })).toMatchObject({ ok: true, people: [{ personId: lena, active: true }] });
    expect(await mapShareRevoke({ mapId, personId: lena })).toEqual({ ok: true, message: COPY.MAP_ACCESS_REMOVED });
    expect(await mapShareLoad({ mapId })).toMatchObject({ ok: true, people: [{ personId: lena, active: false }] });
  });

  it('sends a person their link by email once email is set up, and says so; without it, sends nothing', async () => {
    const { mapId, lena, quiet } = await shared();
    expect(await mapShareSend({ mapId, personId: lena })).toEqual({ ok: false, error: 'invalid', message: COPY.MAP_SHARE_NO_MAIL });
    expect(state.sent).toEqual([]);
    state.mail = true;
    expect(await mapShareLoad({ mapId })).toMatchObject({ ok: true, mailConfigured: true });
    expect(await mapShareSend({ mapId, personId: lena })).toEqual({ ok: true, message: COPY.MAP_LINK_SENT_TO('lena@example.com') });
    expect(state.sent).toEqual([{ to: { ownerUserId: 'u_anna', mapId, personId: lena, side: 'partner', email: 'lena@example.com' }, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }]);
    expect(await mapShareLoad({ mapId })).toMatchObject({ ok: true, people: [{ personId: lena, active: true }] });
    expect(await mapShareSend({ mapId, personId: quiet })).toMatchObject({ ok: false, message: COPY.MAP_PERSON_NO_EMAIL });
    expect(state.sent).toHaveLength(1);
  });

  it('says so when the email couldn’t be sent', async () => {
    const { mapId } = await shared();
    const bounce = await changeMap(state.deps, anna, {
      mapId, change: { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Bo', title: '', email: 'bounce@example.com', role: 'other' } },
    });
    if (!bounce.ok) throw new Error('setup');
    state.mail = true;
    expect(await mapShareSend({ mapId, personId: bounce.value.entityId })).toEqual({ ok: false, error: 'unavailable', message: COPY.MAP_LINK_NOT_SENT });
  });

  it('says why a link can’t be made, in the person’s words', async () => {
    const { mapId, quiet } = await shared();
    expect(await mapShareCopy({ mapId, personId: quiet })).toMatchObject({ ok: false, message: COPY.MAP_PERSON_NO_EMAIL });
    expect(await mapShareCopy({ mapId, personId: 'p_gone' })).toMatchObject({ ok: false, message: COPY.MAP_PERSON_GONE });
    expect(await mapShareCopy({ mapId, personId: quiet, extra: 1 })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('answers signed out to everyone else', async () => {
    const { mapId, lena } = await shared();
    state.session = null;
    expect(await mapShareLoad({ mapId })).toEqual(SIGNED_OUT);
    expect(await mapShareCopy({ mapId, personId: lena })).toEqual(SIGNED_OUT);
    expect(await mapShareRevoke({ mapId, personId: lena })).toEqual(SIGNED_OUT);
    expect(await mapShareSend({ mapId, personId: lena })).toEqual(SIGNED_OUT);
    expect(state.deps.mapLinks.rows).toEqual([]);
  });
});

describe('Notifications: mapNotifyLoad and mapNotifySave', () => {
  it('load the MAP’s settings with the owner’s timezone and whether email goes out, and save them', async () => {
    const partnerId = await acme();
    const started = await mapStart({ partnerId });
    if (!started.ok) throw new Error(started.message);
    const { mapId } = started;
    expect(await mapNotifyLoad({ mapId })).toEqual({
      ok: true, settings: { dueSoonDays: 3, partnerDigest: false, partnerAlerts: 'instant', timezone: 'Europe/Berlin', mailConfigured: false },
    });
    const settings = { dueSoonDays: 1, partnerDigest: true, partnerAlerts: 'off' };
    expect(await mapNotifySave({ mapId, settings })).toEqual({ ok: true, message: COPY.MAP_NOTIFY_SAVED });
    expect(await mapNotifyLoad({ mapId })).toMatchObject({ ok: true, settings });
    expect(await mapNotifySave({ mapId, settings: { ...settings, dueSoonDays: 2 } })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await mapNotifyLoad({ mapId })).toEqual(SIGNED_OUT);
    expect(await mapNotifySave({ mapId, settings })).toEqual(SIGNED_OUT);
  });
});
