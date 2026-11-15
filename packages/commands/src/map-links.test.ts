// Magic links, sessions and asking for a new link, on the commands and PartnerStandard Desk's tables.
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '@partner-desk/copy';
import type { Actor } from './actor';
import type { MapLink } from './directory';
import {
  accessRemoved, endMapSession, MAP_LINK_IDLE_DAYS, MAP_SESSION_DAYS, mapSharing, openMapLink, requestNewMapLink, resolveMapSession, revokeMapLinks, shareMap,
  type MapLinkMail, type RelinkDeps,
} from './map-links';
import { changeMap, startMap } from './maps';
import { changePartner, readPartners } from './partners';
import { hashToken } from './share-tokens';
import { makeTestDeps, TEST_NOW } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const agent = (level: 'read' | 'change' | 'propose'): Actor => ({ kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
const companyId = 'co_aaaaaaaaaa';
const days = (n: number) => new Date(Date.parse(TEST_NOW) + n * 86_400_000).toISOString();
const hours = (n: number) => new Date(Date.parse(TEST_NOW) + n * 3_600_000).toISOString();

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
  let now = TEST_NOW;
  deps.clock = () => now;
  await readPartners(deps, owner, { companyId });
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } }));
  const partner = value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller' } },
  }));
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId: partner.entityId! }));
  const person = async (values: Record<string, unknown>) =>
    value(await changeMap(deps, owner, { mapId, change: { kind: 'add', entity: 'person', values } })).entityId!;
  const lena = await person({ side: 'partner', name: 'Lena Ortiz', title: '', email: 'Lena@Example.com', role: 'sales_lead' });
  const ben = await person({ side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'other' });
  const quiet = await person({ side: 'partner', name: 'Quiet', title: '', email: null, role: 'other' });
  deps.events.events.length = 0;
  return { deps, mapId, lena, ben, quiet, at: (iso: string) => { now = iso; } };
}

describe('shareMap', () => {
  it('makes a link for one person, side and MAP, keeping only the token’s hash and the address’s hash', async () => {
    const { deps, mapId, lena } = await setup();
    const { token, linkId, email, side } = value(await shareMap(deps, owner, { mapId, personId: lena }));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Where Send link sends it: the person's address and side, to the owner's screen only.
    expect([email, side]).toEqual(['Lena@Example.com', 'partner']);
    expect(deps.mapLinks.rows).toEqual([{
      id: linkId, mapId, ownerUserId: 'u1', personId: lena, side: 'partner', emailHash: hashToken('lena@example.com'), tokenHash: hashToken(token),
      createdAt: TEST_NOW, lastUsedAt: null, revokedAt: null,
    }]);
    expect(JSON.stringify(deps.mapLinks.rows)).not.toContain(token);
    expect(deps.events.events).toEqual([expect.objectContaining({ command: 'maps.share', entityIds: [mapId, lena, linkId] })]);
  });

  it('refuses a person without an email, one not in the MAP, an agent and another person', async () => {
    const { deps, mapId, lena, quiet } = await setup();
    expect(await shareMap(deps, owner, { mapId, personId: quiet })).toMatchObject({ ok: false, fieldErrors: { personId: COPY.MAP_PERSON_NO_EMAIL } });
    expect(await shareMap(deps, owner, { mapId, personId: 'p_gone' })).toMatchObject({ ok: false, fieldErrors: { personId: COPY.MAP_PERSON_GONE } });
    for (const level of ['read', 'change', 'propose'] as const) expect(await shareMap(deps, agent(level), { mapId, personId: lena })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await shareMap(deps, stranger, { mapId, personId: lena })).toMatchObject({ ok: false, message: COPY.MAP_NOT_LISTED });
    expect(deps.mapLinks.rows).toEqual([]);
  });
});

describe('opening a link', () => {
  it('opens a session for the link’s MAP, keeping only its hash, and refuses malformed, unknown and revoked tokens', async () => {
    const { deps, mapId, lena } = await setup();
    const { token } = value(await shareMap(deps, owner, { mapId, personId: lena }));
    const opened = await openMapLink(deps, token);
    expect(opened).toMatchObject({ kind: 'session', mapId, expiresAt: days(MAP_SESSION_DAYS) });
    if (opened.kind !== 'session') throw new Error('session');
    expect(deps.mapSessions.rows).toEqual([expect.objectContaining({ mapId, tokenHash: hashToken(opened.sessionToken) })]);
    expect(JSON.stringify(deps.mapSessions.rows)).not.toContain(opened.sessionToken);
    for (const bad of ['nope', 'x'.repeat(43), 42, null]) expect(await openMapLink(deps, bad)).toEqual({ kind: 'invalid' });
    value(await revokeMapLinks(deps, owner, { mapId, personId: lena }));
    expect(await openMapLink(deps, token)).toEqual({ kind: 'invalid' });
  });

  it('expires a link after 90 days without use, counted from its last use', async () => {
    const { deps, mapId, lena, at } = await setup();
    const { token } = value(await shareMap(deps, owner, { mapId, personId: lena }));
    at(days(60));
    expect((await openMapLink(deps, token)).kind).toBe('session');
    at(days(140));
    expect((await openMapLink(deps, token)).kind).toBe('session');
    at(days(140 + MAP_LINK_IDLE_DAYS + 1));
    expect(await openMapLink(deps, token)).toEqual({ kind: 'expired', mapId });
  });
});

describe('a link holder’s session', () => {
  async function opened() {
    const s = await setup();
    const { token, linkId } = value(await shareMap(s.deps, owner, { mapId: s.mapId, personId: s.lena }));
    const o = await openMapLink(s.deps, token);
    if (o.kind !== 'session') throw new Error('session');
    return { ...s, token, linkId, sessionToken: o.sessionToken };
  }

  it('resolves to the person with the link, for its own MAP only', async () => {
    const { deps, mapId, lena, linkId, sessionToken } = await opened();
    expect(await resolveMapSession(deps, sessionToken, mapId)).toEqual({
      kind: 'active', actor: { kind: 'link', userId: 'u1', linkId, mapId, personId: lena, side: 'partner', name: '' },
    });
    expect(await resolveMapSession(deps, sessionToken, 'map_other')).toEqual({ kind: 'none' });
    expect(await resolveMapSession(deps, 'x'.repeat(43), mapId)).toEqual({ kind: 'none' });
    expect(await resolveMapSession(deps, 'short', mapId)).toEqual({ kind: 'none' });
  });

  it('stops at once when the owner revokes the link, and ends the session', async () => {
    const { deps, mapId, lena, sessionToken } = await opened();
    expect(value(await revokeMapLinks(deps, owner, { mapId, personId: lena }))).toEqual({ revoked: 1 });
    expect(await resolveMapSession(deps, sessionToken, mapId)).toEqual({ kind: 'revoked' });
    expect(deps.mapSessions.rows).toEqual([]);
    expect(deps.events.events.filter((e) => e.command === 'maps.revoke')).toEqual([expect.objectContaining({ entityIds: [mapId, lena] })]);
  });

  it('expires after 30 unused days, and stays alive while it is used', async () => {
    const { deps, mapId, sessionToken, at } = await opened();
    at(days(20));
    expect((await resolveMapSession(deps, sessionToken, mapId)).kind).toBe('active');
    at(days(45));
    expect((await resolveMapSession(deps, sessionToken, mapId)).kind).toBe('active');
    at(days(45 + MAP_SESSION_DAYS));
    expect(await resolveMapSession(deps, sessionToken, mapId)).toEqual({ kind: 'expired', mapId });
    expect(deps.mapSessions.rows).toEqual([]);
  });

  it('records the link’s use and renews the session at most once an hour', async () => {
    const { deps, mapId, linkId, sessionToken, at } = await opened();
    const touch = vi.spyOn(deps.mapLinks, 'touch');
    const extend = vi.spyOn(deps.mapSessions, 'extend');
    at(hours(0.5));
    await resolveMapSession(deps, sessionToken, mapId);
    expect(touch).not.toHaveBeenCalled();
    expect(extend).not.toHaveBeenCalled();
    at(hours(2));
    await resolveMapSession(deps, sessionToken, mapId);
    expect(touch).toHaveBeenCalledWith(linkId, hours(2));
    expect(extend).toHaveBeenCalledWith(expect.any(String), new Date(Date.parse(hours(2)) + MAP_SESSION_DAYS * 86_400_000).toISOString());
  });

  it('refuses another person and an agent the link commands, and needs a person to revoke for one', async () => {
    const { deps, mapId, lena } = await opened();
    expect(await revokeMapLinks(deps, stranger, { mapId, personId: lena })).toMatchObject({ ok: false, message: COPY.MAP_NOT_LISTED });
    expect(await revokeMapLinks(deps, agent('read'), { mapId, personId: lena })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(deps.mapLinks.rows.every((l) => l.revokedAt === null)).toBe(true);
  });
});

describe('ending a session', () => {
  it('ends the session of its own MAP only; the link still opens a new one', async () => {
    const { deps, mapId, lena } = await setup();
    const { token } = value(await shareMap(deps, owner, { mapId, personId: lena }));
    const o = await openMapLink(deps, token);
    if (o.kind !== 'session') throw new Error('session');
    await endMapSession(deps, o.sessionToken, 'map_other00000');
    await endMapSession(deps, 'x'.repeat(43), mapId);
    await endMapSession(deps, 42, mapId);
    expect(deps.mapSessions.rows).toHaveLength(1);
    await endMapSession(deps, o.sessionToken, mapId);
    expect(deps.mapSessions.rows).toEqual([]);
    expect(await resolveMapSession(deps, o.sessionToken, mapId)).toEqual({ kind: 'none' });
    expect((await openMapLink(deps, token)).kind).toBe('session');
  });

  it('survives a failing delete, logging the MAP’s id only', async () => {
    const { deps, mapId, lena } = await setup();
    const { token } = value(await shareMap(deps, owner, { mapId, personId: lena }));
    const o = await openMapLink(deps, token);
    if (o.kind !== 'session') throw new Error('session');
    vi.spyOn(deps.mapSessions, 'delete').mockRejectedValueOnce(new Error(`boom ${o.sessionToken}`));
    const log = vi.spyOn(deps, 'log');
    await expect(endMapSession(deps, o.sessionToken, mapId)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('map_session_end_failed', { mapId });
    expect(JSON.stringify(log.mock.calls)).not.toContain(o.sessionToken);
  });
});

describe('who has access (the Share dialog)', () => {
  it('lists the people with an email on both sides, with their link’s state, and never an address it doesn’t show', async () => {
    const { deps, mapId, lena, ben, at } = await setup();
    expect(value(await mapSharing(deps, owner, { mapId }))).toEqual({
      people: [
        { personId: lena, name: 'Lena Ortiz', side: 'partner', email: 'Lena@Example.com', lastUsedAt: null, active: false, inPlan: true },
        { personId: ben, name: 'Ben Ito', side: 'us', email: 'ben@example.com', lastUsedAt: null, active: false, inPlan: true },
      ],
    });
    const { token } = value(await shareMap(deps, owner, { mapId, personId: lena }));
    expect(value(await mapSharing(deps, owner, { mapId })).people[0]).toMatchObject({ active: true, lastUsedAt: null });
    at(hours(3));
    await openMapLink(deps, token);
    expect(value(await mapSharing(deps, owner, { mapId })).people[0]).toMatchObject({ active: true, lastUsedAt: hours(3) });
    value(await revokeMapLinks(deps, owner, { mapId, personId: lena }));
    expect(value(await mapSharing(deps, owner, { mapId })).people[0]).toMatchObject({ active: false, lastUsedAt: hours(3) });
    expect(JSON.stringify(value(await mapSharing(deps, owner, { mapId })))).not.toContain(hashToken('lena@example.com'));
  });

  it('says a link idle for 90 days is no longer active', async () => {
    const { deps, mapId, lena, at } = await setup();
    value(await shareMap(deps, owner, { mapId, personId: lena }));
    at(days(MAP_LINK_IDLE_DAYS + 1));
    expect(value(await mapSharing(deps, owner, { mapId })).people[0]).toMatchObject({ personId: lena, active: false });
  });

  it('keeps someone taken off People who still has a link, without a name or address, so the owner can revoke it', async () => {
    const { deps, mapId, lena } = await setup();
    value(await shareMap(deps, owner, { mapId, personId: lena }));
    value(await changeMap(deps, owner, { mapId, change: { kind: 'delete', entity: 'person', id: lena } }));
    const { people } = value(await mapSharing(deps, owner, { mapId }));
    expect(people.find((p) => p.personId === lena)).toEqual({
      personId: lena, name: null, side: 'partner', email: null, lastUsedAt: null, active: true, inPlan: false,
    });
    value(await revokeMapLinks(deps, owner, { mapId, personId: lena }));
    expect(value(await mapSharing(deps, owner, { mapId })).people.find((p) => p.personId === lena)).toBeUndefined();
  });

  it('is the owner’s only: an agent, a link holder and another person are refused, and records no event for the read', async () => {
    const { deps, mapId, lena } = await setup();
    for (const level of ['read', 'change', 'propose'] as const) expect(await mapSharing(deps, agent(level), { mapId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await mapSharing(deps, stranger, { mapId })).toMatchObject({ ok: false, message: COPY.MAP_NOT_LISTED });
    const link: Actor = { kind: 'link', userId: 'u1', linkId: 'ml_x', mapId, personId: lena, side: 'partner', name: '' };
    expect(await mapSharing(deps, link, { mapId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await mapSharing(deps, owner, { mapId: 42 })).toMatchObject({ ok: false, error: 'invalid' });
    deps.events.events.length = 0;
    value(await mapSharing(deps, owner, { mapId }));
    expect(deps.events.events).toEqual([]);
  });
});

describe('asking for a new link', () => {
  async function relink(mail: MapLinkMail | null = { sendLink: vi.fn(async () => {}) }) {
    const s = await setup();
    const pending: Array<Promise<void>> = [];
    const relinkDeps: RelinkDeps = { ...s.deps, mail, defer: (work) => { pending.push(work()); } };
    const flush = () => Promise.all(pending).then(() => undefined);
    return { ...s, relinkDeps, flush, mail };
  }

  it('sends a new link to the address when it matches a working link, whatever its case or spaces', async () => {
    const { deps, mapId, lena, relinkDeps, flush, mail } = await relink();
    value(await shareMap(deps, owner, { mapId, personId: lena }));
    expect(await requestNewMapLink(relinkDeps, { mapId, email: '  LENA@example.com', ip: '1.2.3.4' })).toEqual({ ok: true, message: COPY.MAP_RELINK_SENT });
    await flush();
    expect(mail!.sendLink).toHaveBeenCalledTimes(1);
    const [to, token] = vi.mocked(mail!.sendLink).mock.calls[0]!;
    expect(to).toEqual({ ownerUserId: 'u1', mapId, personId: lena, side: 'partner', email: 'lena@example.com' });
    expect((await openMapLink(deps, token)).kind).toBe('session');
  });

  it('answers the same way, sending nothing, for an address or a MAP without access, or a link revoked', async () => {
    const { deps, mapId, lena, ben, relinkDeps, flush, mail } = await relink();
    value(await shareMap(deps, owner, { mapId, personId: lena }));
    value(await shareMap(deps, owner, { mapId, personId: ben }));
    value(await revokeMapLinks(deps, owner, { mapId, personId: ben }));
    for (const input of [
      { mapId, email: 'nobody@example.com', ip: null },
      { mapId: 'map_other', email: 'lena@example.com', ip: null },
      { mapId, email: 'ben@example.com', ip: null },
    ]) expect(await requestNewMapLink(relinkDeps, input)).toEqual({ ok: true, message: COPY.MAP_RELINK_SENT });
    await flush();
    expect(mail!.sendLink).not.toHaveBeenCalled();
  });

  it('limits requests to 5 an hour per address and 20 an hour per IP', async () => {
    const { mapId, relinkDeps } = await relink();
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push((await requestNewMapLink(relinkDeps, { mapId, email: 'a@example.com', ip: `10.0.0.${i}` })).message);
    expect(answers.slice(0, 5).every((m) => m === COPY.MAP_RELINK_SENT)).toBe(true);
    expect(answers[5]).toBe(COPY.MAP_RELINK_LIMITED);
    const byIp = [];
    for (let i = 0; i < 21; i++) byIp.push((await requestNewMapLink(relinkDeps, { mapId, email: `p${i}@example.com`, ip: '9.9.9.9' })).message);
    expect(byIp.filter((m) => m === COPY.MAP_RELINK_LIMITED)).toHaveLength(1);
  });

  it('answers before any lookup or send, and survives a failing one, logging ids only', async () => {
    const send = vi.fn(async () => { throw new Error('lena@example.com Acme'); });
    const { deps, mapId, lena, relinkDeps, flush } = await relink({ sendLink: send });
    const lines: unknown[] = [];
    relinkDeps.log = (event, ids) => { lines.push([event, ids]); };
    value(await shareMap(deps, owner, { mapId, personId: lena }));
    expect(await requestNewMapLink(relinkDeps, { mapId, email: 'lena@example.com', ip: null })).toEqual({ ok: true, message: COPY.MAP_RELINK_SENT });
    await flush();
    expect(send).toHaveBeenCalled();
    expect(JSON.stringify(lines)).not.toMatch(/@|Acme/);
  });

  it('refuses an address that isn’t one, and says when email isn’t set up', async () => {
    const { mapId, relinkDeps } = await relink(null);
    for (const email of ['nope', 42, 'a'.repeat(250) + '@x.io']) {
      expect(await requestNewMapLink(relinkDeps, { mapId, email, ip: null })).toEqual({ ok: false, message: COPY.MAP_RELINK_BAD_EMAIL });
    }
    expect(await requestNewMapLink(relinkDeps, { mapId, email: 'lena@example.com', ip: null })).toEqual({ ok: false, message: COPY.MAP_RELINK_NO_MAIL });
  });
});

describe('accessRemoved (question 12)', () => {
  const link = (personId: string, o: Partial<MapLink> = {}): MapLink => ({
    id: `ml_${personId}_${o.createdAt ?? 'a'}`, mapId: 'map_0123456789', ownerUserId: 'u1', personId, side: 'partner', emailHash: 'h',
    createdAt: '2026-11-01T08:00:00.000Z', lastUsedAt: null, revokedAt: null, ...o,
  });

  it('is false for someone who never had a link', () => {
    expect(accessRemoved([], 'p_1')).toBe(false);
  });

  it('is false for someone with one working link', () => {
    expect(accessRemoved([link('p_1')], 'p_1')).toBe(false);
  });

  it('is true once every link of the person is revoked, and false for another person on the same MAP', () => {
    const links = [
      link('p_1', { revokedAt: '2026-11-03T09:00:00.000Z' }),
      link('p_1', { createdAt: '2026-11-02T08:00:00.000Z', revokedAt: '2026-11-03T09:00:00.000Z' }),
      link('p_2'),
    ];
    expect(accessRemoved(links, 'p_1')).toBe(true);
    expect(accessRemoved(links, 'p_2')).toBe(false);
  });

  it('is false again after a new link, but true for a since before the revoke', () => {
    const links = [
      link('p_1', { revokedAt: '2026-11-03T09:00:00.000Z' }),
      link('p_1', { createdAt: '2026-11-03T09:30:00.000Z' }),
    ];
    expect(accessRemoved(links, 'p_1')).toBe(false);
    expect(accessRemoved(links, 'p_1', '2026-11-02T08:00:00.000Z')).toBe(true);
    expect(accessRemoved(links, 'p_1', '2026-11-03T10:00:00.000Z')).toBe(false);
  });

  it('counts an idle link as not removed', () => {
    // Last used far more than 90 days ago: expired for the link page, but nobody took the person's access away.
    const idle = link('p_1', { createdAt: '2026-01-01T08:00:00.000Z', lastUsedAt: '2026-02-01T08:00:00.000Z' });
    expect(accessRemoved([idle], 'p_1')).toBe(false);
    expect(accessRemoved([idle], 'p_1', '2026-01-01T00:00:00.000Z')).toBe(false);
  });
});
