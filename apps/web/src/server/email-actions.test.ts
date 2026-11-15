import { describe, expect, it, vi } from 'vitest';
import { changeMap, changePartner, readPartners, revokeMapLinks, shareMap, startMap, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { performAction, viewAction, type EmailActionDeps } from './email-actions';
import { shortEmailHash, signAction, type EmailAction } from './signed-tokens';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const companyId = 'co_aaaaaaaaaa';
const SECRET = 'test-secret-that-is-at-least-32-characters';
const NOW = Date.parse('2026-11-03T08:00:00.000Z');

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

/** Acme's MAP: Ben on our side and Lena on the partner's, each owning an activity; Lena also owns one of our side's. */
async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa' } });
  await readPartners(deps, owner, { companyId });
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } }));
  const partnerId = value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller', whyItFits: 'Fits' } },
  })).entityId!;
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const add = async (entity: 'activity' | 'person', values: Record<string, unknown>) =>
    value(await changeMap(deps, owner, { mapId, change: { kind: 'add', entity, values } })).entityId!;
  const ben = await add('person', { side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'marketing_lead' });
  const lena = await add('person', { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'sales_lead' });
  const theirs = await add('activity', { title: 'Book the kickoff', side: 'partner', ownerId: lena, dueDate: '2026-11-01', note: 'Agenda drafted' });
  const crossSide = await add('activity', { title: 'Our price list', side: 'us', ownerId: lena, dueDate: '2026-11-01' });
  const ours = await add('activity', { title: 'Send the pricing sheet', side: 'us', ownerId: ben, dueDate: '2026-11-04' });
  const paused: string[] = [];
  const logged: Array<[string, Record<string, string>]> = [];
  const action: EmailActionDeps = {
    secret: SECRET, directory: deps.directory, mapLinks: deps.mapLinks, ownerDeps: async (id) => (id === 'u1' ? deps : null), limiter: deps.rateLimits,
    now: () => NOW, pause: async (id) => { paused.push(id); }, log: (event, ids) => { logged.push([event, ids]); },
  };
  const token = (act: EmailAction, o: { activityId?: string; personId?: string; email?: string; at?: number } = {}) => signAction(SECRET, {
    mapId, activityId: o.activityId ?? theirs, action: act, personId: o.personId ?? lena, emailHash: shortEmailHash(o.email ?? 'lena@example.com'),
  }, o.at ?? NOW);
  const activity = async (id = theirs) => {
    const entry = (await deps.directory.map(mapId))!;
    const read = await deps.maps.read({ fileId: entry.fileId });
    if (!read.ok) throw new Error('unreadable');
    return read.snapshot.value.activities.find((a) => a.id === id)!;
  };
  return { deps, action, mapId, partnerId, ben, lena, theirs, crossSide, ours, paused, logged, token, activity };
}

describe('the confirmation page (GET, Review Focus 2)', () => {
  it('shows what the button will do, and changes nothing however often it is opened', async () => {
    const t = await setup();
    const apply = vi.spyOn(t.deps.maps, 'apply');
    const hit = vi.spyOn(t.deps.rateLimits, 'hit');
    expect(await viewAction(t.action, t.token('done'))).toEqual({
      kind: 'confirm',
      view: { action: 'done', partnerName: 'Acme', title: 'Book the kickoff', status: 'not_started', note: 'Agenda drafted', personName: 'Lena Ortiz' },
    });
    for (let i = 0; i < 10; i++) await viewAction(t.action, t.token('update'));
    expect(apply).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
    expect(t.paused).toEqual([]);
    expect((await t.activity()).status).toBe('not_started');
    expect(await t.deps.mapEvents.since(t.mapId, null)).toEqual([]);
  });

  it('shows the refusal up front for an activity of the other side, still writing nothing', async () => {
    const t = await setup();
    const apply = vi.spyOn(t.deps.maps, 'apply');
    expect(await viewAction(t.action, t.token('done', { activityId: t.crossSide }))).toEqual({ kind: 'refused' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('says an expired, tampered, foreign or bad link no longer works', async () => {
    const t = await setup();
    const good = t.token('done');
    const tampered = `${good.slice(0, 10)}${good[10] === 'A' ? 'B' : 'A'}${good.slice(11)}`;
    const expired = t.token('done', { at: NOW - 14 * 86_400_000 });
    for (const bad of ['garbage', tampered, expired, signAction('another-secret-that-is-at-least-32-chars', { mapId: t.mapId, activityId: t.theirs, action: 'done', personId: t.lena, emailHash: shortEmailHash('lena@example.com') }, NOW)]) {
      expect(await viewAction(t.action, bad)).toEqual({ kind: 'invalid' });
    }
  });

  it('says it no longer works once the address or the activity’s owner changed, and gone once the activity is', async () => {
    const t = await setup();
    expect(await viewAction(t.action, t.token('done', { email: 'old@example.com' }))).toEqual({ kind: 'invalid' });
    expect(await viewAction(t.action, t.token('done', { activityId: t.ours }))).toEqual({ kind: 'invalid' });
    expect(await viewAction(t.action, t.token('done', { activityId: 'act_gone0000' }))).toEqual({ kind: 'gone' });
  });

  it('says the MAP can’t be updated while it is paused for its owner’s Google access', async () => {
    const t = await setup();
    await t.deps.directory.pauseMap(t.mapId);
    expect(await viewAction(t.action, t.token('done'))).toEqual({ kind: 'reconnect' });
  });
});

describe('the button (POST)', () => {
  it('marks the activity done as the person, by link, and the owner sees who did it', async () => {
    const t = await setup();
    expect(await performAction(t.action, t.token('done'), {}, '203.0.113.7')).toEqual({ ok: true, message: 'Done: “Book the kickoff” is now done.' });
    expect(await t.activity()).toMatchObject({ status: 'done', updatedBy: 'Lena Ortiz (by link)' });
    expect((await t.deps.mapEvents.since(t.mapId, null)).map((e) => [e.action, e.actorRef])).toEqual([['status_changed', `email:${t.lena}`]]);
  });

  it('takes a status and a note for Update…, and only for Update…', async () => {
    const t = await setup();
    expect((await performAction(t.action, t.token('update'), { status: 'blocked', note: '  Waiting for legal ' }, null)).ok).toBe(true);
    expect(await t.activity()).toMatchObject({ status: 'blocked', note: 'Waiting for legal' });
    expect(await performAction(t.action, t.token('update'), { status: 'deleted' }, null)).toMatchObject({ ok: false, kind: 'bad_input' });
    expect(await performAction(t.action, t.token('update'), { status: 'done', note: 'x'.repeat(2001) }, null)).toMatchObject({ ok: false, kind: 'bad_input' });
    expect((await performAction(t.action, t.token('in_progress'), { status: 'na', note: 'ignored' }, null)).ok).toBe(true);
    expect(await t.activity()).toMatchObject({ status: 'in_progress', note: 'Waiting for legal' });
  });

  it('is refused for an activity of the other side, and nothing is written (Review Focus 1)', async () => {
    const t = await setup();
    const before = await t.activity(t.crossSide);
    expect(await performAction(t.action, t.token('done', { activityId: t.crossSide }), {}, null)).toMatchObject({ ok: false, kind: 'refused' });
    expect(await t.activity(t.crossSide)).toEqual(before);
  });

  it('is refused after the partner type’s exit, as on the link page', async () => {
    const t = await setup();
    value(await changePartner(t.deps, owner, { companyId, change: { kind: 'markSigned', partnerId: t.partnerId, signedDate: '2026-10-01' } }));
    value(await changePartner(t.deps, owner, { companyId, change: { kind: 'markExited', partnerId: t.partnerId, exitedDate: '2026-10-28', reason: 'Moved on' } }));
    expect(await viewAction(t.action, t.token('done'))).toEqual({ kind: 'refused' });
    expect(await performAction(t.action, t.token('done'), {}, null)).toMatchObject({ ok: false, kind: 'refused' });
    expect((await t.activity()).status).toBe('not_started');
  });

  it('refuses an expired link and limits repeats, counting every POST against its address', async () => {
    const t = await setup();
    expect(await performAction(t.action, t.token('done', { at: NOW - 15 * 86_400_000 }), {}, null)).toMatchObject({ ok: false, kind: 'invalid' });
    const token = t.token('in_progress');
    for (let i = 0; i < 10; i++) expect((await performAction(t.action, token, {}, '198.51.100.1')).ok).toBe(true);
    expect(await performAction(t.action, token, {}, '198.51.100.1')).toMatchObject({ ok: false, kind: 'limited' });
  });

  it('pauses the MAP when its owner’s Google access is broken', async () => {
    const t = await setup();
    t.deps.maps.read = async () => ({ ok: false, error: 'auth', message: 'Reconnect' });
    expect(await performAction(t.action, t.token('done'), {}, null)).toMatchObject({ ok: false, kind: 'reconnect' });
    expect(t.paused).toEqual([t.mapId]);
  });
});

describe('a person whose access was removed (question 12)', () => {
  /** Shares the MAP with Lena at `sharedAt`, then removes her access at `removedAt`, as the Share dialog does. */
  async function removeLena(t: Awaited<ReturnType<typeof setup>>, sharedAt: string, removedAt: string) {
    t.deps.clock = () => sharedAt;
    value(await shareMap(t.deps, owner, { mapId: t.mapId, personId: t.lena }));
    t.deps.clock = () => removedAt;
    value(await revokeMapLinks(t.deps, owner, { mapId: t.mapId, personId: t.lena }));
  }

  it('says the person’s access was removed, and changes nothing', async () => {
    const t = await setup();
    await removeLena(t, '2026-11-02T08:00:00.000Z', '2026-11-03T09:00:00.000Z');
    const read = vi.spyOn(t.deps.maps, 'read');
    const apply = vi.spyOn(t.deps.maps, 'apply');
    expect(await viewAction(t.action, t.token('done'))).toEqual({ kind: 'removed' });
    expect(read).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('refuses the button of a removed person, and nothing is written', async () => {
    const t = await setup();
    await removeLena(t, '2026-11-02T08:00:00.000Z', '2026-11-03T09:00:00.000Z');
    const before = await t.activity();
    const apply = vi.spyOn(t.deps.maps, 'apply');
    expect(await performAction(t.action, t.token('done'), {}, null)).toEqual({ ok: false, kind: 'removed', message: COPY.MAP_ACTION_FAILED.removed });
    expect(apply).not.toHaveBeenCalled();
    expect(await t.activity()).toEqual(before);
    expect(t.paused).toEqual([]);
  });

  it('a button from before a revoke stays refused after the person is shared again', async () => {
    const t = await setup();
    // The reminder was signed at 08:00; her access was removed at 09:00 and shared again at 09:30.
    const old = t.token('done');
    await removeLena(t, '2026-11-02T08:00:00.000Z', '2026-11-03T09:00:00.000Z');
    t.deps.clock = () => '2026-11-03T09:30:00.000Z';
    value(await shareMap(t.deps, owner, { mapId: t.mapId, personId: t.lena }));
    expect(await viewAction(t.action, old)).toEqual({ kind: 'removed' });
    expect(await performAction(t.action, old, {}, null)).toMatchObject({ ok: false, kind: 'removed' });
    expect((await t.activity()).status).toBe('not_started');
    // A reminder made after the new share works.
    const fresh = t.token('done', { at: Date.parse('2026-11-03T10:00:00.000Z') });
    expect(await viewAction(t.action, fresh)).toMatchObject({ kind: 'confirm' });
    expect((await performAction(t.action, fresh, {}, null)).ok).toBe(true);
    expect((await t.activity()).status).toBe('done');
  });

  it('a person who never had a link still uses their buttons', async () => {
    const t = await setup();
    expect(await t.deps.mapLinks.listForMap(t.mapId)).toEqual([]);
    expect((await performAction(t.action, t.token('done'), {}, null)).ok).toBe(true);
    expect((await t.activity()).status).toBe('done');
  });

  it('says the MAP can’t be reached when its links can’t be read, on GET and POST, and changes nothing', async () => {
    const t = await setup();
    t.action.mapLinks = { listForMap: async () => { throw new Error('db down'); } };
    const read = vi.spyOn(t.deps.maps, 'read');
    expect(await viewAction(t.action, t.token('done'))).toEqual({ kind: 'unavailable' });
    expect(await performAction(t.action, t.token('done'), {}, null)).toEqual({ ok: false, kind: 'unavailable', message: COPY.MAP_ACTION_FAILED.unavailable });
    expect(read).not.toHaveBeenCalled();
    expect(t.paused).toEqual([]);
    expect(t.logged).toEqual([['email_action_links_failed', { mapId: t.mapId }], ['email_action_links_failed', { mapId: t.mapId }]]);
    expect((await t.activity()).status).toBe('not_started');
  });

  it('is told even while the MAP is paused for its owner’s Google access', async () => {
    const t = await setup();
    await removeLena(t, '2026-11-02T08:00:00.000Z', '2026-11-03T09:00:00.000Z');
    await t.deps.directory.pauseMap(t.mapId);
    expect(await viewAction(t.action, t.token('done'))).toEqual({ kind: 'removed' });
    expect(await performAction(t.action, t.token('done'), {}, null)).toMatchObject({ ok: false, kind: 'removed' });
    expect(t.paused).toEqual([]);
  });
});
