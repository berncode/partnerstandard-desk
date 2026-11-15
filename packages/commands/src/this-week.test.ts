import { describe, expect, it, vi } from 'vitest';
import type { MapChange } from '@partner-desk/core';
import type { Actor } from './actor';
import { changeMap, startMap } from './maps';
import { changeMarket, createMarket, readMarket } from './markets';
import { changePartner, readPartners } from './partners';
import { acceptProposal, createProposal, withdrawProposal } from './proposals';
import { readCompanyFacts } from './programs';
import { readThisWeek } from './this-week';
import { makeTestDeps } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
  await deps.companies.rename('u1', 'Halden');
  await readPartners(deps, owner, { companyId });
  await readCompanyFacts(deps, owner, { companyId });
  return deps;
}
type TestDeps = Awaited<ReturnType<typeof setup>>;

const partnerChange = async (deps: TestDeps, change: Record<string, unknown>) => value(await changePartner(deps, owner, { companyId, change }));

/** A signed partnership with one activity of ours that is late. */
async function signedMap(deps: TestDeps, company: string, partnerType: string) {
  const accountId = (await partnerChange(deps, { kind: 'add', entity: 'account', values: { company } })).entityId!;
  const partnerId = (await partnerChange(deps, { kind: 'add', entity: 'partner', values: { accountId, partnerType } })).entityId!;
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const change: MapChange = { kind: 'add', entity: 'activity', values: { title: 'SECRET late task', side: 'us', dueDate: '2026-10-20' } };
  value(await changeMap(deps, owner, { mapId, change }));
  await partnerChange(deps, { kind: 'markSigned', partnerId, signedDate: '2026-09-01' });
  return { mapId, partnerId, accountId };
}

describe('readThisWeek', () => {
  it('reads Partners once and each MAP once, and writes nothing', async () => {
    const deps = await setup();
    const a = await signedMap(deps, 'Acme', 'reseller');
    const b = await signedMap(deps, 'Brightwave', 'referral');
    deps.events.events.length = 0;
    const partnersRead = vi.spyOn(deps.partnerBooks, 'read');
    const mapRead = vi.spyOn(deps.maps, 'read');
    const writes = [vi.spyOn(deps.partnerBooks, 'apply'), vi.spyOn(deps.maps, 'applyMany'), vi.spyOn(deps.maps, 'apply')];
    const rename = vi.spyOn(deps.directory, 'renameMap');
    const lastChange = vi.spyOn(deps.directory, 'setMapLastChange');

    const week = value(await readThisWeek(deps, owner, { companyId }));
    expect(partnersRead).toHaveBeenCalledTimes(1);
    expect(mapRead).toHaveBeenCalledTimes(2);
    for (const w of writes) expect(w).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(lastChange).not.toHaveBeenCalled();
    expect(deps.events.events).toEqual([]);
    expect(week.due.map((g) => g.mapId).sort()).toEqual([a.mapId, b.mapId].sort());
    expect(week.due[0]!.activities[0]).toMatchObject({ overdueDays: 8 });
  });

  it('lists an unreadable MAP under need you, and the rest still show', async () => {
    const deps = await setup();
    const a = await signedMap(deps, 'Acme', 'reseller');
    const broken = await signedMap(deps, 'Delta', 'affiliate');
    const brokenFile = (await deps.directory.map(broken.mapId))!.fileId;
    const read = deps.maps.read.bind(deps.maps);
    vi.spyOn(deps.maps, 'read').mockImplementation(async (ref) =>
      (ref.fileId === brokenFile ? { ok: false, error: 'unavailable', message: 'SECRET x' } : read(ref)));

    const week = value(await readThisWeek(deps, owner, { companyId }));
    // Acme is 8 days late (at risk); the one that can't be opened comes last, with no reasons.
    expect(week.needYou.map((n) => n.mapId)).toEqual([a.mapId, broken.mapId]);
    expect(week.needYou[1]).toEqual({ mapId: broken.mapId, displayName: 'Delta as affiliate partner', reasons: [] });
    expect(week.due.map((g) => g.mapId)).toEqual([a.mapId]);
  });

  it('counts a step move from the event log, and a partner from its last update when it has none', async () => {
    const deps = await setup();
    const accountId = (await partnerChange(deps, { kind: 'add', entity: 'account', values: { company: 'Acme' } })).entityId!;
    const partnerId = (await partnerChange(deps, { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } })).entityId!;
    // Added today: not waiting.
    expect(value(await readThisWeek(deps, owner, { companyId })).waiting).toEqual([]);
    const book = deps.directory.books.get(companyId)!;
    deps.events.events.push({
      id: 'ev_1', at: '2026-10-10T08:00:00.000Z', command: 'partners.change', change: 'setStep', fileId: book.fileId,
      entityIds: [partnerId], actorKind: 'owner', actorUserId: 'u1',
    });
    expect(value(await readThisWeek(deps, owner, { companyId })).waiting).toMatchObject([{ partnerId, reason: 'stalled', days: 18 }]);
  });

  it('gives an empty week to a company whose Partners file isn’t made yet (the first visit after sign-in)', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    expect(await readThisWeek(deps, owner, { companyId })).toEqual({ ok: true, value: { reviews: [], needYou: [], due: [], waiting: [], proposals: [] } });
    expect(await deps.directory.partnerBook(companyId)).toBeNull();
  });

  it('refuses another owner and a bad company id', async () => {
    const deps = await setup();
    expect(await readThisWeek(deps, owner, { companyId: 'nope' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await readThisWeek(deps, stranger, { companyId })).toMatchObject({ ok: false });
  });

  it('lists the waiting proposals from the book and the index without reading a market', async () => {
    const deps = await setup();
    deps.proposals.allowApp('u1', 'c_claude', 'Claude');
    const claude: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'propose', via: { kind: 'app', clientId: 'c_claude' } };
    const accountId = (await partnerChange(deps, { kind: 'add', entity: 'account', values: { company: 'Acme' } })).entityId!;
    const partnerId = (await partnerChange(deps, { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } })).entityId!;
    await partnerChange(deps, { kind: 'setStep', partnerId, to: 'discovery_call' });
    const { marketId } = value(await createMarket(deps, owner, {
      companyId, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
    }));
    const hypothesisId = value(await changeMarket(deps, owner, { marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'Banks' } } })).entityId!;
    const propose = async (proposal: Record<string, unknown>) => value(await createProposal(deps, claude, { companyId, proposal })).proposalId;
    const partnerOf = async () => value(await readPartners(deps, owner, { companyId })).value.partners.find((p) => p.id === partnerId)!;
    const step = await propose({ kind: 'stage', partnerId, expectedUpdatedAt: (await partnerOf()).updatedAt, to: 'qualification', reason: 'They asked' });
    const close = await propose({ kind: 'close', partnerId, expectedUpdatedAt: (await partnerOf()).updatedAt, as: 'no', reason: 'A rival' });
    const market = value(await readMarket(deps, owner, { marketId })).value;
    const hypothesisAt = market.hypotheses.find((h) => h.id === hypothesisId)!.updatedAt;
    const status = await propose({ kind: 'hypothesisStatus', marketId, hypothesisId, expectedUpdatedAt: hypothesisAt, to: 'holds', reason: 'Two calls say so' });
    const gone = await propose({ kind: 'signed', partnerId, expectedUpdatedAt: (await partnerOf()).updatedAt, signedDate: '2026-10-20', reason: 'Signed' });
    value(await withdrawProposal(deps, claude, { companyId, proposalId: gone }));
    const answered = await propose({ kind: 'marketStatus', marketId, expectedUpdatedAt: market.info.updatedAt, to: 'validated', note: '', reason: 'Enough partners' });
    value(await acceptProposal(deps, owner, { companyId, proposalId: answered }));
    deps.events.events.length = 0;
    const marketRead = vi.spyOn(deps.markets, 'read');
    const partnersRead = vi.spyOn(deps.partnerBooks, 'read');

    const week = value(await readThisWeek(deps, owner, { companyId }));

    expect(marketRead).not.toHaveBeenCalled();
    expect(partnersRead).toHaveBeenCalledTimes(1);
    expect(deps.events.events).toEqual([]);
    // All made at the same time here, so in any order.
    const lines = week.proposals.map((p) => [p.head.id, p.head.kind, p.state, p.head.agentName, p.about, p.partnerType, p.oneClick] as const);
    expect([...lines].sort((a, b) => a[1].localeCompare(b[1]))).toEqual([
      [close, 'close', 'waiting', 'Claude', 'Acme', 'reseller', false],
      [status, 'hypothesisStatus', 'waiting', 'Claude', 'Banks', null, true],
      // A move into Qualification gets the stepper's advice unless the hypothesis holds, which This week can't tell.
      [step, 'stage', 'waiting', 'Claude', 'Acme', 'reseller', false],
    ]);
  });

  it('sends a status proposal to the market page when a call with one of its partners is recent (the change log offer)', async () => {
    const deps = await setup();
    deps.proposals.allowApp('u1', 'c_claude', 'Claude');
    const claude: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'propose', via: { kind: 'app', clientId: 'c_claude' } };
    const { marketId } = value(await createMarket(deps, owner, {
      companyId, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
    }));
    const market = value(await readMarket(deps, owner, { marketId })).value;
    const proposalId = value(await createProposal(deps, claude, {
      companyId, proposal: { kind: 'marketStatus', marketId, expectedUpdatedAt: market.info.updatedAt, to: 'validated', note: '', reason: 'Enough partners' },
    })).proposalId;
    const oneClick = async () => value(await readThisWeek(deps, owner, { companyId })).proposals.find((p) => p.head.id === proposalId)!.oneClick;
    expect(await oneClick()).toBe(true);

    const accountId = (await partnerChange(deps, { kind: 'add', entity: 'account', values: { company: 'Acme' } })).entityId!;
    const partnerId = (await partnerChange(deps, { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } })).entityId!;
    await partnerChange(deps, { kind: 'add', entity: 'marketLink', values: { partnerId, marketId, hypothesisId: null } });
    // A call 8 days ago is too old for the offer; one 6 days ago is recent (today is 2026-10-28).
    await partnerChange(deps, { kind: 'add', entity: 'call', values: { partnerId, date: '2026-10-20', kind: 'discovery' } });
    expect(await oneClick()).toBe(true);
    await partnerChange(deps, { kind: 'add', entity: 'call', values: { partnerId, date: '2026-10-22', kind: 'discovery' } });
    expect(await oneClick()).toBe(false);
  });

  it('lists no proposals for an agent, and none when the index can’t be read', async () => {
    const deps = await setup();
    const reader: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_claude' } };
    expect(value(await readThisWeek(deps, reader, { companyId })).proposals).toEqual([]);
    vi.spyOn(deps.proposals, 'list').mockRejectedValue(new Error('down'));
    expect(value(await readThisWeek(deps, owner, { companyId })).proposals).toEqual([]);
  });
});
