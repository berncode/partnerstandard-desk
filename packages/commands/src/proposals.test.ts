import { proposalViews, type ProposalItem } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { MemoryFileLock, serializeApplies } from '@partner-desk/storage';
import { describe, expect, it } from 'vitest';
import type { Actor, AgentLevel } from './actor';
import { changeMap, readMap, startMap } from './maps';
import { changeMarket, createMarket, readMarket } from './markets';
import { changePartner, readPartners } from './partners';
import { acceptProposal, countProposals, createProposal, listProposals, rejectProposal, withdrawProposal } from './proposals';
import { FORBIDDEN } from './result';
import { makeTestDeps, TEST_NOW } from './testing';

const CO = 'co_aaaaaaaaaa';
const BEN_CO = 'co_bbbbbbbbbb';
const ruth: Actor = { kind: 'owner', userId: 'u_bern', displayName: 'Ruth' };
const ben: Actor = { kind: 'owner', userId: 'u_ben', displayName: 'Ben' };
const app = (agentName: string, clientId: string, level: AgentLevel = 'propose'): Actor =>
  ({ kind: 'agent', userId: 'u_bern', displayName: 'Ruth', agentName, level, via: { kind: 'app', clientId } });
const claude = app('Claude', 'c_claude_1');
const key = (level: AgentLevel = 'propose'): Actor =>
  ({ kind: 'agent', userId: 'u_bern', displayName: 'Ruth', agentName: 'n8n', level, via: { kind: 'key', keyId: 'k_n8n' } });
const bensAgent: Actor = { kind: 'agent', userId: 'u_ben', displayName: 'Ben', agentName: 'Claude', level: 'propose', via: { kind: 'app', clientId: 'c_ben' } };

const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(Date.parse(TEST_NOW) + days * DAY).toISOString();

type TestDeps = ReturnType<typeof makeTestDeps>;

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function setup() {
  const deps = makeTestDeps({ companies: { u_bern: CO, u_ben: BEN_CO } });
  await readPartners(deps, ruth, { companyId: CO });
  await readPartners(deps, ben, { companyId: BEN_CO });
  deps.proposals.allowApp('u_bern', 'c_claude_1', 'Claude');
  deps.proposals.allowApp('u_bern', 'c_cursor', 'Cursor');
  deps.proposals.addKey('u_bern', 'k_n8n', 'n8n');
  return deps;
}

const change = async (deps: TestDeps, c: Record<string, unknown>) => value(await changePartner(deps, ruth, { companyId: CO, change: c })).entityId!;

/** A company and its partner type, added by hand. */
async function addPartner(deps: TestDeps, company: string, partnerType = 'reseller', website = '') {
  const accountId = await change(deps, { kind: 'add', entity: 'account', values: { company, website } });
  const partnerId = await change(deps, { kind: 'add', entity: 'partner', values: { accountId, partnerType, whyItFits: 'SECRET fit' } });
  return { accountId, partnerId };
}

async function book(deps: TestDeps) {
  return value(await readPartners(deps, ruth, { companyId: CO })).value;
}

const itemsOf = async (deps: TestDeps, proposalId: string): Promise<ProposalItem[]> =>
  (await book(deps)).proposalItems.filter((i) => i.proposalId === proposalId);

const fourC = (partnerId: string, expectedUpdatedAt: string | null = TEST_NOW) => ({
  kind: 'fourC', partnerId, expectedUpdatedAt,
  letters: {
    customerBase: { score: 3, evidence: 'SECRET evidence one' }, credibility: { score: 2, evidence: 'SECRET evidence two' },
    capability: { score: 1, evidence: 'SECRET evidence three' }, commitment: { score: 0, evidence: 'SECRET evidence four' },
  },
});
const stage = (partnerId: string, to = 'discovery_call') => ({ kind: 'stage', partnerId, expectedUpdatedAt: TEST_NOW, to, reason: 'SECRET reason' });

const propose = (deps: TestDeps, actor: Actor, proposal: unknown) => createProposal(deps, actor, { companyId: CO, proposal });

async function addMarket(deps: TestDeps) {
  const made = value(await createMarket(deps, ruth, {
    companyId: CO, info: { marketName: 'SECRET Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
  }));
  const hypothesisId = value(await changeMarket(deps, ruth, {
    marketId: made.marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'SECRET banks' } },
  })).entityId!;
  return { marketId: made.marketId, hypothesisId };
}

const company = (name: string, website = '') => ({ company: name, website, whyItFits: 'SECRET why' });

describe('createProposal', () => {
  it('a propose-level agent’s 4C proposal writes four rows and one index row, and no score changes', async () => {
    const deps = await setup();
    const { accountId, partnerId } = await addPartner(deps, 'SECRET Acme');
    const before = (await book(deps)).partners.find((p) => p.id === partnerId)!;
    deps.events.events.length = 0;

    const made = value(await propose(deps, claude, fourC(partnerId)));

    expect(made).toEqual({
      proposalId: expect.stringMatching(/^prp_[0-9a-z]{10}$/), status: 'waiting', message: 'Proposed. It waits for Ruth in PartnerStandard Desk.', replaced: null,
    });
    const after = await book(deps);
    const items = after.proposalItems.filter((i) => i.proposalId === made.proposalId);
    expect(items.map((i) => [i.what, i.proposed, i.status, i.proposedBy])).toEqual([
      ['desk.customerBase', '3', 'waiting', 'Desk Agent for Ruth'], ['desk.credibility', '2', 'waiting', 'Desk Agent for Ruth'],
      ['desk.capability', '1', 'waiting', 'Desk Agent for Ruth'], ['desk.commitment', '0', 'waiting', 'Desk Agent for Ruth'],
    ]);
    expect(after.partners.find((p) => p.id === partnerId)!.desk).toEqual(before.desk);
    expect(deps.proposals.rows).toEqual([{
      id: made.proposalId, userId: 'u_bern', kind: 'fourC', accountId, partnerId, marketId: null, hypothesisId: null, status: 'waiting',
      createdAt: TEST_NOW, answeredAt: null, expiresAt: later(30), madeBy: { kind: 'app', agentName: 'Claude', clientId: 'c_claude_1' },
      fileId: (await deps.directory.partnerBook(CO))!.fileId,
    }]);
    expect(deps.events.events.filter((e) => e.command.startsWith('proposals.'))).toEqual([expect.objectContaining({
      command: 'proposals.create', actorKind: 'agent', entityIds: [made.proposalId, accountId, partnerId], change: 'fourC', proposalId: made.proposalId,
    })]);
  });

  it('a change-level agent’s proposal is forbidden', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    for (const actor of [app('Claude', 'c_claude_1', 'change'), app('Claude', 'c_claude_1', 'read'), key('change'), ruth]) {
      expect(await propose(deps, actor, fourC(partnerId))).toEqual(FORBIDDEN);
    }
    expect((await book(deps)).proposalItems).toEqual([]);
    expect(deps.proposals.rows).toEqual([]);
  });

  it('a proposal against an old expectedUpdatedAt is a conflict and writes nothing', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    expect(await propose(deps, claude, fourC(partnerId, '2026-10-01T09:00:00.000Z'))).toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT });
    expect(await propose(deps, claude, fourC(partnerId, null))).toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT });
    expect((await book(deps)).proposalItems).toEqual([]);
    expect(deps.proposals.rows).toEqual([]);
  });

  it('a 4C proposal with no letter tells the agent "Propose at least one letter."', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    expect(await propose(deps, claude, { kind: 'fourC', partnerId, expectedUpdatedAt: TEST_NOW, letters: {} })).toEqual({
      ok: false, error: 'invalid', message: COPY.PROPOSAL_NO_LETTER, fieldErrors: { 'proposal.letters': COPY.PROPOSAL_NO_LETTER },
    });
    expect(deps.proposals.rows).toEqual([]);
  });

  it('a proposal the rules refuse answers invalid with the rule’s words, and writes nothing', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    expect(await propose(deps, claude, stage(partnerId, 'exit'))).toEqual({ ok: false, error: 'invalid', message: 'Only a person moves a partner into Exit.' });
    expect(await propose(deps, claude, { ...stage(partnerId), partnerId: 'p_gone00' })).toMatchObject({ ok: false });
    expect((await book(deps)).proposalItems).toEqual([]);
    expect(deps.proposals.rows).toEqual([]);
  });

  it('another person’s company, or another person’s agent, reaches nothing', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    expect(await createProposal(deps, bensAgent, { companyId: CO, proposal: fourC(partnerId) })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(deps.proposals.rows).toEqual([]);
  });

  it('a second proposal from the same app replaces the waiting one, also under a new client id', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const first = value(await propose(deps, claude, stage(partnerId)));
    // claude.ai registered again: a new client id, the same app name.
    deps.proposals.allowApp('u_bern', 'c_claude_2', 'Claude');
    const second = value(await propose(deps, app('Claude', 'c_claude_2'), { ...stage(partnerId), reason: 'SECRET another reason' }));

    expect(second.replaced).toBe(first.proposalId);
    expect(deps.proposals.rows.map((r) => [r.id, r.status])).toEqual([[first.proposalId, 'replaced'], [second.proposalId, 'waiting']]);
    expect((await itemsOf(deps, first.proposalId)).map((i) => i.status)).toEqual(['replaced']);
    expect((await itemsOf(deps, second.proposalId)).map((i) => i.status)).toEqual(['waiting']);
    // Another kind for the same partner type is its own proposal.
    const third = value(await propose(deps, claude, fourC(partnerId)));
    expect(third.replaced).toBeNull();
  });

  it('another app of the same person gets its own waiting proposal', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const byClaude = value(await propose(deps, claude, stage(partnerId)));
    const byCursor = value(await propose(deps, app('Cursor', 'c_cursor'), stage(partnerId)));
    const byKey = value(await propose(deps, key(), stage(partnerId)));
    expect([byCursor.replaced, byKey.replaced]).toEqual([null, null]);
    expect(deps.proposals.rows.map((r) => r.status)).toEqual(['waiting', 'waiting', 'waiting']);
    expect((await itemsOf(deps, byClaude.proposalId)).map((i) => i.status)).toEqual(['waiting']);
  });

  it('two identical proposals at once: exactly one ends waiting, the other replaced', async () => {
    const deps = await setup();
    deps.partnerBooks = serializeApplies(deps.partnerBooks, new MemoryFileLock());
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const [a, b] = await Promise.all([propose(deps, claude, stage(partnerId)), propose(deps, claude, stage(partnerId))]);
    expect(a.ok && b.ok).toBe(true);
    expect(deps.proposals.rows.map((r) => r.status).sort()).toEqual(['replaced', 'waiting']);
    const items = (await book(deps)).proposalItems;
    expect(items.map((i) => i.status).sort()).toEqual(['replaced', 'waiting']);
  });

  it('a waiting proposal past its expiry is left for the clean-up, not replaced', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const first = value(await propose(deps, claude, stage(partnerId)));
    deps.clock = () => later(31);
    const second = value(await propose(deps, claude, stage(partnerId)));
    expect(second.replaced).toBeNull();
    expect(deps.proposals.rows.map((r) => [r.id, r.status])).toEqual([[first.proposalId, 'waiting'], [second.proposalId, 'waiting']]);
    // The tab's write marks the old rows Expired by their date.
    expect((await itemsOf(deps, first.proposalId)).map((i) => [i.status, i.answeredOn])).toEqual([['expired', later(30)]]);
    expect(await deps.proposals.expire(later(31))).toBe(1);
    expect(deps.proposals.rows.map((r) => r.status)).toEqual(['expired', 'waiting']);
  });

  it('propose_partners answers which companies are already partners, by index', async () => {
    const deps = await setup();
    const { marketId, hypothesisId } = await addMarket(deps);
    const linked = await addPartner(deps, 'SECRET Linked', 'reseller', 'linked.example');
    await change(deps, { kind: 'add', entity: 'marketLink', values: { partnerId: linked.partnerId, marketId } });
    await addPartner(deps, 'SECRET Existing', 'reseller', 'existing.example');
    await addPartner(deps, 'SECRET Other', 'distributor', 'other.example');
    value(await changeMarket(deps, ruth, { marketId, change: { kind: 'add', entity: 'exclusion', values: { company: 'SECRET Excluded', website: '', reason: 'no' } } }));

    const companies = [
      company('SECRET New', 'new.example'), company('SECRET Linked', 'linked.example'), company('SECRET Existing', 'existing.example'),
      company('SECRET Other', 'other.example'), company('SECRET Excluded'),
    ];
    const made = value(await propose(deps, claude, { kind: 'partners', marketId, hypothesisId, companies, reason: 'SECRET reason' }));

    // Linked, existing and the same company as a Distributor; the excluded one isn't a partner.
    expect(made.alreadyPartners).toEqual([1, 2, 3]);
    // The proposal keeps every company: the preview checks again at accepting.
    expect((await itemsOf(deps, made.proposalId)).map((i) => i.proposed)).toEqual(companies.map((c) => c.company));
    expect(deps.proposals.rows[0]).toMatchObject({ kind: 'partners', marketId, hypothesisId, accountId: null, partnerId: null });
    // Another kind has no such list.
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    expect(value(await propose(deps, claude, stage(partnerId)))).not.toHaveProperty('alreadyPartners');
  });

  it('50 new companies replacing 50 waiting ones, and an orphan row, write in one batch of more than 100', async () => {
    const deps = await setup();
    const { marketId } = await addMarket(deps);
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const companies = Array.from({ length: 50 }, (_, i) => company(`SECRET Co ${i}`, `co${i}.example`));
    const first = value(await propose(deps, claude, { kind: 'partners', marketId, hypothesisId: null, companies, reason: 'SECRET reason' }));
    const add = deps.proposals.add.bind(deps.proposals);
    deps.proposals.add = async () => { throw new Error('db down'); };
    await propose(deps, claude, stage(partnerId));
    deps.proposals.add = add;
    let writes = 0;
    const applyMany = deps.partnerBooks.applyMany.bind(deps.partnerBooks);
    deps.partnerBooks.applyMany = async (...args) => { writes += 1; expect(args[1]).toHaveLength(101); return applyMany(...args); };
    const second = value(await propose(deps, claude, { kind: 'partners', marketId, hypothesisId: null, companies, reason: 'SECRET reason' }));
    expect(writes).toBe(1);
    expect(second.replaced).toBe(first.proposalId);
    expect((await itemsOf(deps, first.proposalId)).every((i) => i.status === 'replaced')).toBe(true);
    expect(await itemsOf(deps, second.proposalId)).toHaveLength(50);
  });

  it('market kinds check the market: an archived one refuses a market status, and an old updatedAt is a conflict', async () => {
    const deps = await setup();
    const { marketId, hypothesisId } = await addMarket(deps);
    const hyp = value(await propose(deps, claude, { kind: 'hypothesisStatus', marketId, hypothesisId, expectedUpdatedAt: TEST_NOW, to: 'holds', reason: 'SECRET reason' }));
    expect(deps.proposals.rows[0]).toMatchObject({ id: hyp.proposalId, kind: 'hypothesisStatus', marketId, hypothesisId });
    expect(await propose(deps, claude, { kind: 'marketStatus', marketId, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', to: 'validated', note: '', reason: 'SECRET reason' }))
      .toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT });
    await deps.directory.setArchived(marketId, TEST_NOW);
    expect(await propose(deps, claude, { kind: 'marketStatus', marketId, expectedUpdatedAt: null, to: 'validated', note: '', reason: 'SECRET reason' }))
      .toEqual({ ok: false, error: 'invalid', message: COPY.PROPOSAL_MARKET_ARCHIVED });
    expect(await propose(deps, claude, { kind: 'marketStatus', marketId: 'm_nothere00', expectedUpdatedAt: TEST_NOW, to: 'validated', note: '', reason: 'r' }))
      .toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('a create that Google refuses writes no index row and answers auth', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    deps.partnerBooks.applyMany = async () => ({ ok: false, error: 'auth', message: 'Reconnect' });
    expect(await propose(deps, claude, fourC(partnerId))).toEqual({ ok: false, error: 'auth', message: 'Reconnect' });
    deps.partnerBooks.read = async () => ({ ok: false, error: 'auth', message: 'Reconnect' });
    expect(await propose(deps, claude, fourC(partnerId))).toEqual({ ok: false, error: 'auth', message: 'Reconnect' });
    expect(deps.proposals.rows).toEqual([]);
    expect(deps.webhooks.deliveries).toEqual([]);
  });

  it('an index read that throws inside the lock answers unavailable, logs ids only and writes nothing', async () => {
    const deps = await setup();
    deps.partnerBooks = serializeApplies(deps.partnerBooks, new MemoryFileLock());
    const logs: Array<[string, Record<string, string>]> = [];
    deps.log = (event, ids) => { logs.push([event, ids]); };
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    const waiting = deps.proposals.waiting.bind(deps.proposals);
    deps.proposals.waiting = async () => { throw new Error('SECRET db down'); };
    expect(await propose(deps, claude, fourC(partnerId))).toEqual({ ok: false, error: 'unavailable', message: COPY.AGENT_TRY_AGAIN });
    deps.proposals.waiting = waiting;
    deps.proposals.get = async () => { throw new Error('SECRET db down'); };
    expect(await withdrawProposal(deps, claude, { companyId: CO, proposalId: made.proposalId }))
      .toEqual({ ok: false, error: 'unavailable', message: COPY.AGENT_TRY_AGAIN });
    expect(logs).toEqual([
      ['proposal_index_failed', { userId: 'u_bern', step: 'waiting' }], ['proposal_index_failed', { userId: 'u_bern', step: 'get' }],
    ]);
    expect((await book(deps)).proposalItems.map((i) => [i.proposalId, i.status])).toEqual([[made.proposalId, 'waiting']]);
    expect(deps.proposals.rows.map((r) => r.status)).toEqual(['waiting']);
    // The lock was let go: the next proposal runs.
    deps.proposals.get = async () => null;
    expect((await propose(deps, claude, fourC(partnerId))).ok).toBe(true);
  });

  it('a failed index write answers unavailable, and the next proposal marks the orphan rows Not sent', async () => {
    const deps = await setup();
    const logs: Array<[string, Record<string, string>]> = [];
    deps.log = (event, ids) => { logs.push([event, ids]); };
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const add = deps.proposals.add.bind(deps.proposals);
    deps.proposals.add = async () => { throw new Error('db down'); };
    expect(await propose(deps, claude, stage(partnerId))).toEqual({ ok: false, error: 'unavailable', message: COPY.AGENT_TRY_AGAIN });
    const orphan = (await book(deps)).proposalItems;
    expect(orphan.map((i) => i.status)).toEqual(['waiting']);
    expect(logs).toEqual([['proposal_index_failed', { userId: 'u_bern', proposalId: orphan[0]!.proposalId }]]);
    expect(deps.events.events.filter((e) => e.command === 'proposals.create')).toEqual([]);

    deps.proposals.add = add;
    const next = value(await propose(deps, claude, stage(partnerId)));
    expect(next.replaced).toBeNull();
    expect((await itemsOf(deps, orphan[0]!.proposalId)).map((i) => i.status)).toEqual(['not_sent']);
    expect((await itemsOf(deps, next.proposalId)).map((i) => i.status)).toEqual(['waiting']);
  });

  it('the next proposal marks the rows of one the index has withdrawn or replaced', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const other = await addPartner(deps, 'SECRET Beta');
    const first = value(await propose(deps, claude, stage(partnerId)));
    // The index answered, the tab's write didn't happen (a hand edit put it back, or a write failed).
    await deps.proposals.answer('u_bern', first.proposalId, 'withdrawn', TEST_NOW);
    value(await propose(deps, claude, stage(other.partnerId)));
    expect((await itemsOf(deps, first.proposalId)).map((i) => i.status)).toEqual(['withdrawn']);
  });

  it('proposal.created goes to webhooks subscribed to it, with ids and the kind only', async () => {
    const deps = await setup();
    const { accountId, partnerId } = await addPartner(deps, 'SECRET Acme');
    const on = await deps.webhooks.create({ userId: 'u_bern', url: 'https://hooks.example.com/in', events: ['proposal.created'] });
    await deps.webhooks.create({ userId: 'u_bern', url: 'https://other.example.com/in', events: ['partner.signed', 'proposal.answered'] });
    await deps.webhooks.create({ userId: 'u_ben', url: 'https://ben.example.com/in', events: ['proposal.created'] });
    const made = value(await propose(deps, claude, fourC(partnerId)));
    expect(deps.webhooks.deliveries.map((d) => [d.webhookId, d.type, d.data])).toEqual([
      [on.webhook.id, 'proposal.created', { proposalId: made.proposalId, kind: 'fourC', accountId, partnerId }],
    ]);
  });

  it('the index, the events, the webhook data and the log lines hold no score, evidence, reason or company name', async () => {
    const deps = await setup();
    const logs: unknown[] = [];
    deps.log = (event, ids) => { logs.push([event, ids]); };
    await deps.webhooks.create({ userId: 'u_bern', url: 'https://hooks.example.com/in', events: ['proposal.created'] });
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const { marketId, hypothesisId } = await addMarket(deps);
    deps.events.events.length = 0;
    value(await propose(deps, claude, fourC(partnerId)));
    value(await propose(deps, claude, { kind: 'partners', marketId, hypothesisId, companies: [company('SECRET New')], reason: 'SECRET reason' }));
    value(await propose(deps, claude, { kind: 'marketStatus', marketId, expectedUpdatedAt: null, to: 'validated', note: 'SECRET note', reason: 'SECRET reason' }));
    deps.webhooks.enqueue = async () => { throw new Error('SECRET down'); };
    value(await propose(deps, claude, stage(partnerId)));
    deps.proposals.add = async () => { throw new Error('SECRET down'); };
    expect(await propose(deps, claude, fourC(partnerId))).toMatchObject({ ok: false, error: 'unavailable' });
    const stored = JSON.stringify({ index: deps.proposals.rows, events: deps.events.events, webhooks: deps.webhooks.deliveries.map((d) => d.data), logs });
    expect(logs.map((l) => (l as [string])[0])).toEqual(['webhook_enqueue_failed', 'proposal_index_failed']);
    expect(stored).not.toContain('SECRET');
    expect(stored).not.toMatch(/score|evidence|reason|letters|companies|Ruth|Claude for/i);
  });
});

describe('listProposals', () => {
  it('list_proposals shows an agent only its own; another person’s id is not_found', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const byClaude = value(await propose(deps, claude, stage(partnerId)));
    const byCursor = value(await propose(deps, app('Cursor', 'c_cursor'), stage(partnerId)));
    const byKey = value(await propose(deps, key(), fourC(partnerId)));

    const ids = async (actor: Actor, input: unknown = {}) => value(await listProposals(deps, actor, input)).map((e) => e.id);
    expect(await ids(claude)).toEqual([byClaude.proposalId]);
    // A reconnected Claude still sees its own.
    expect(await ids(app('Claude', 'c_claude_2'))).toEqual([byClaude.proposalId]);
    expect(await ids(app('Cursor', 'c_cursor'))).toEqual([byCursor.proposalId]);
    expect(await ids(key('read'))).toEqual([byKey.proposalId]);
    expect((await ids(ruth)).sort()).toEqual([byClaude.proposalId, byCursor.proposalId, byKey.proposalId].sort());
    expect(await ids(ruth, { proposalId: byCursor.proposalId })).toEqual([byCursor.proposalId]);
    expect(await ids(ruth, { status: 'replaced' })).toEqual([]);

    const gone = { ok: false, error: 'not_found', message: COPY.GONE };
    expect(await listProposals(deps, claude, { proposalId: byCursor.proposalId })).toEqual(gone);
    expect(await listProposals(deps, ben, { proposalId: byClaude.proposalId })).toEqual(gone);
    expect(await listProposals(deps, bensAgent, { proposalId: byClaude.proposalId })).toEqual(gone);
    expect(value(await listProposals(deps, ben, {}))).toEqual([]);
    expect(await listProposals(deps, claude, { status: 'nope' })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('shows the last 90 days only', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const old = value(await propose(deps, claude, stage(partnerId)));
    deps.clock = () => later(91);
    const recent = value(await propose(deps, claude, fourC(partnerId)));
    expect(value(await listProposals(deps, ruth, {})).map((e) => e.id)).toEqual([recent.proposalId]);
    expect(await listProposals(deps, ruth, { proposalId: old.proposalId })).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('countProposals', () => {
  it('counts the person’s waiting proposals, in all and by agent', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    value(await propose(deps, claude, stage(partnerId)));
    value(await propose(deps, claude, fourC(partnerId)));
    value(await propose(deps, key(), fourC(partnerId)));
    expect(value(await countProposals(deps, ruth))).toEqual({ total: 3, byMaker: { 'app:Claude': 2, 'key:k_n8n': 1 } });
    expect(value(await countProposals(deps, key('read')))).toEqual({ total: 3, byMaker: { 'app:Claude': 2, 'key:k_n8n': 1 } });
    expect(value(await countProposals(deps, ben))).toEqual({ total: 0, byMaker: {} });
  });

  it('counts only the current Partners file’s, as This week lists them', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    // One left from a Partners file made again since (the old file's id is still on its index row).
    const row = deps.proposals.rows.find((r) => r.id === made.proposalId)!;
    deps.proposals.rows.push({ ...row, id: 'prp_oldfile000', fileId: 'file_old_partners' });
    expect(value(await countProposals(deps, ruth))).toEqual({ total: 1, byMaker: { 'app:Claude': 1 } });
  });
});

describe('withdrawProposal', () => {
  const withdraw = (deps: TestDeps, actor: Actor, proposalId: string) => withdrawProposal(deps, actor, { companyId: CO, proposalId });

  it('withdraws its own waiting proposal: rows Withdrawn, the index withdrawn, no webhook', async () => {
    const deps = await setup();
    await deps.webhooks.create({ userId: 'u_bern', url: 'https://hooks.example.com/in', events: ['proposal.created', 'proposal.answered'] });
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, fourC(partnerId)));
    deps.webhooks.deliveries.length = 0;
    deps.events.events.length = 0;
    expect(await withdraw(deps, app('Claude', 'c_claude_2'), made.proposalId)).toEqual({ ok: true, value: { proposalId: made.proposalId, status: 'withdrawn' } });
    expect((await itemsOf(deps, made.proposalId)).map((i) => i.status)).toEqual(['withdrawn', 'withdrawn', 'withdrawn', 'withdrawn']);
    expect(deps.proposals.rows[0]).toMatchObject({ status: 'withdrawn', answeredAt: TEST_NOW });
    expect(deps.webhooks.deliveries).toEqual([]);
    expect(deps.events.events.filter((e) => e.command.startsWith('proposals.'))).toEqual([expect.objectContaining({ command: 'proposals.withdraw', actorKind: 'agent', proposalId: made.proposalId })]);
    // Withdrawn already: the same answer, nothing written again.
    expect(await withdraw(deps, claude, made.proposalId)).toEqual({ ok: true, value: { proposalId: made.proposalId, status: 'withdrawn' } });
  });

  it('withdrawing one the person answered is a conflict with "Ruth already answered this proposal."', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    await deps.proposals.answer('u_bern', made.proposalId, 'rejected', TEST_NOW);
    expect(await withdraw(deps, claude, made.proposalId)).toEqual({ ok: false, error: 'conflict', message: 'Ruth already answered this proposal.' });

    // Answered in the tab while the index still waits (its write failed): the rows win.
    const second = value(await propose(deps, claude, fourC(partnerId)));
    const items = await itemsOf(deps, second.proposalId);
    await deps.partnerBooks.applyMany({ fileId: (await deps.directory.partnerBook(CO))!.fileId }, items.map((i) => ({
      kind: 'update', entity: 'proposalItem', id: i.id, expectedUpdatedAt: i.updatedAt, patch: { status: 'accepted', answeredOn: TEST_NOW },
    })), { now: TEST_NOW, actor: 'Ruth' });
    expect(await withdraw(deps, claude, second.proposalId)).toEqual({ ok: false, error: 'conflict', message: 'Ruth already answered this proposal.' });
    expect(deps.proposals.rows.find((r) => r.id === second.proposalId)!.status).toBe('waiting');
  });

  it('another agent’s or another person’s proposal id is not_found; a change agent may not withdraw', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    const gone = { ok: false, error: 'not_found', message: COPY.GONE };
    expect(await withdraw(deps, app('Cursor', 'c_cursor'), made.proposalId)).toEqual(gone);
    expect(await withdraw(deps, key(), made.proposalId)).toEqual(gone);
    expect(await withdraw(deps, claude, 'prp_nothere000')).toEqual(gone);
    expect(await withdrawProposal(deps, bensAgent, { companyId: BEN_CO, proposalId: made.proposalId })).toEqual(gone);
    expect(await withdraw(deps, app('Claude', 'c_claude_1', 'change'), made.proposalId)).toEqual(FORBIDDEN);
    expect(await withdraw(deps, ruth, made.proposalId)).toEqual(FORBIDDEN);
    expect(deps.proposals.rows[0]!.status).toBe('waiting');
  });

  it('a proposal past its expiry can’t be withdrawn: it expired', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    deps.clock = () => later(30);
    expect(await withdraw(deps, claude, made.proposalId)).toEqual({ ok: false, error: 'invalid', message: COPY.PROPOSAL_EXPIRED });
    await deps.proposals.expire(later(30));
    expect(await withdraw(deps, claude, made.proposalId)).toEqual({ ok: false, error: 'invalid', message: COPY.PROPOSAL_EXPIRED });
    expect((await itemsOf(deps, made.proposalId)).map((i) => i.status)).toEqual(['waiting']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Accepting and rejecting (task 8)

const accept = (deps: TestDeps, input: Record<string, unknown>, actor: Actor = ruth) =>
  acceptProposal(deps, actor, { companyId: CO, ...input });
const reject = (deps: TestDeps, input: Record<string, unknown>, actor: Actor = ruth) =>
  rejectProposal(deps, actor, { companyId: CO, ...input });
const PROPOSED_BY = 'Ruth, proposed by Desk Agent';
const indexOf = (deps: TestDeps, id: string) => deps.proposals.rows.find((r) => r.id === id)!;
const letterOnly = (partnerId: string, credibility: number) => ({
  kind: 'fourC', partnerId, expectedUpdatedAt: TEST_NOW, letters: { credibility: { score: credibility, evidence: 'SECRET evidence' } },
});

/** The card as the page builds it: the person's index entries and the book (and a market) as they are now. */
async function viewOf(deps: TestDeps, proposalId: string, marketId?: string) {
  const entries = value(await listProposals(deps, ruth, {}));
  const markets = marketId === undefined ? {} : { [marketId]: { market: value(await readMarket(deps, ruth, { marketId })).value, archived: false } };
  return proposalViews(entries, { book: await book(deps), markets }, deps.clock()).find((v) => v.head.id === proposalId);
}

describe('acceptProposal', () => {
  it('an index read that throws in an accept or a reject answers unavailable, logs ids only and writes nothing', async () => {
    const deps = await setup();
    const logs: Array<[string, Record<string, string>]> = [];
    deps.log = (event, ids) => { logs.push([event, ids]); };
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    const before = await book(deps);
    deps.proposals.get = async () => { throw new Error('SECRET db down'); };
    expect(await accept(deps, { proposalId: made.proposalId })).toEqual({ ok: false, error: 'unavailable', message: COPY.AGENT_TRY_AGAIN });
    expect(await reject(deps, { proposalId: made.proposalId, note: 'SECRET note' })).toEqual({ ok: false, error: 'unavailable', message: COPY.AGENT_TRY_AGAIN });
    expect(logs).toEqual([
      ['proposal_index_failed', { userId: 'u_bern', step: 'get' }], ['proposal_index_failed', { userId: 'u_bern', step: 'get' }],
    ]);
    expect(await book(deps)).toEqual(before);
    expect(deps.proposals.rows.map((r) => r.status)).toEqual(['waiting']);
  });

  it('accepting two of four letters sets two desk scores, Updated by "Ruth, proposed by Desk Agent", and the proposal is partly_accepted', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, fourC(partnerId)));

    const out = value(await accept(deps, { proposalId: made.proposalId, letters: ['capability', 'customerBase'] }));

    expect(out.status).toBe('partly_accepted');
    const partner = out.book.value.partners.find((p) => p.id === partnerId)!;
    expect(partner.desk).toEqual({ customerBase: 3, credibility: null, capability: 1, commitment: null });
    expect(partner.updatedBy).toBe(PROPOSED_BY);
    expect(out.book.value.qualifications.find((q) => q.partnerId === partnerId)!.deskNotes)
      .toEqual({ customerBase: 'SECRET evidence one', credibility: '', capability: 'SECRET evidence three', commitment: '' });
    expect((await itemsOf(deps, made.proposalId)).map((i) => [i.what, i.status, i.answeredOn, i.updatedBy])).toEqual([
      ['desk.customerBase', 'accepted', TEST_NOW, PROPOSED_BY], ['desk.credibility', 'rejected', TEST_NOW, PROPOSED_BY],
      ['desk.capability', 'accepted', TEST_NOW, PROPOSED_BY], ['desk.commitment', 'rejected', TEST_NOW, PROPOSED_BY],
    ]);
    expect(indexOf(deps, made.proposalId)).toMatchObject({ status: 'partly_accepted', answeredAt: TEST_NOW });
    expect(await viewOf(deps, made.proposalId)).toMatchObject({ state: 'answered', answeredLine: 'Accepted 2 of 4' });
    // Answered: a second answer is a conflict, and nothing changes. The person reads it on their own screen.
    expect(await accept(deps, { proposalId: made.proposalId })).toEqual({ ok: false, error: 'conflict', message: 'You already answered this proposal.' });
    expect(await reject(deps, { proposalId: made.proposalId })).toEqual({ ok: false, error: 'conflict', message: 'You already answered this proposal.' });

    // All four letters, when none are named: accepted.
    const other = await addPartner(deps, 'SECRET Beta');
    const all = value(await propose(deps, claude, fourC(other.partnerId)));
    expect(value(await accept(deps, { proposalId: all.proposalId })).status).toBe('accepted');
    expect(await accept(deps, { proposalId: 'prp_nothere000' })).toEqual({ ok: false, error: 'not_found', message: COPY.GONE });
  });

  it('accepting some letters with a note puts the note on the letters left out, and only on them', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, fourC(partnerId)));
    expect(value(await accept(deps, { proposalId: made.proposalId, letters: ['customerBase', 'capability'], note: 'SECRET too early' })).status)
      .toBe('partly_accepted');
    expect((await itemsOf(deps, made.proposalId)).map((i) => [i.what, i.status, i.answerNote])).toEqual([
      ['desk.customerBase', 'accepted', ''], ['desk.credibility', 'rejected', 'SECRET too early'],
      ['desk.capability', 'accepted', ''], ['desk.commitment', 'rejected', 'SECRET too early'],
    ]);
    // A note fits only the kinds a person accepts some of.
    const other = await addPartner(deps, 'SECRET Beta');
    const moving = value(await propose(deps, claude, stage(other.partnerId)));
    expect(await accept(deps, { proposalId: moving.proposalId, note: 'x' })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('the evidence goes below a desk note the person wrote', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    await change(deps, { kind: 'add', entity: 'qualification', values: { partnerId, deskNotes: { customerBase: 'SECRET my own words' } } });
    const made = value(await propose(deps, claude, fourC(partnerId)));
    const out = value(await accept(deps, { proposalId: made.proposalId }));
    expect(out.book.value.qualifications.find((q) => q.partnerId === partnerId)!.deskNotes).toEqual({
      customerBase: 'SECRET my own words\nSECRET evidence one', credibility: 'SECRET evidence two',
      capability: 'SECRET evidence three', commitment: 'SECRET evidence four',
    });
  });

  it('the change, the note and the rows’ statuses are one write: a refused change writes no row status', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, fourC(partnerId)));
    const closing = value(await propose(deps, claude, { kind: 'close', partnerId, expectedUpdatedAt: TEST_NOW, as: 'no', reason: 'SECRET reason' }));
    let writes = 0;
    const applyMany = deps.partnerBooks.applyMany.bind(deps.partnerBooks);
    deps.partnerBooks.applyMany = async (...args) => { writes += 1; return applyMany(...args); };
    deps.partnerBooks.apply = async () => { throw new Error('an accept is one write'); };

    value(await accept(deps, { proposalId: made.proposalId }));
    expect(writes).toBe(1);

    // The close dialog's reason wins over the proposal's; a blank one is refused by the rule, and nothing is written.
    writes = 0;
    const refused = await accept(deps, { proposalId: closing.proposalId, reason: '   ' });
    expect(refused).toMatchObject({ ok: false, error: 'invalid', message: COPY.REASON_NEEDED });
    expect(writes).toBe(1);
    expect((await itemsOf(deps, closing.proposalId)).map((i) => i.status)).toEqual(['waiting']);
    expect(indexOf(deps, closing.proposalId).status).toBe('waiting');
    expect((await book(deps)).partners.find((p) => p.id === partnerId)!.closed).toBeNull();

    const closed = value(await accept(deps, { proposalId: closing.proposalId, as: 'not_now', reason: 'SECRET my reason' }));
    expect(closed.book.value.partners.find((p) => p.id === partnerId)).toMatchObject({ closed: 'not_now', closedReason: 'SECRET my reason' });
  });

  it('accept after a change since needs the updatedAt the person saw; another change since is a conflict and the proposal still waits', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, letterOnly(partnerId, 3)));
    const stageMade = value(await propose(deps, claude, stage(partnerId)));
    // Ruth sets Credibility to 1 by hand; a day later they open the proposal.
    deps.clock = () => later(1);
    await change(deps, { kind: 'update', entity: 'partner', id: partnerId, patch: { desk: { credibility: 1 } } });
    const seen = (await viewOf(deps, made.proposalId))!;
    expect(seen).toMatchObject({ state: 'changed', targetUpdatedAt: later(1) });
    expect(seen.rows.map((r) => [r.now, r.proposed])).toEqual([['1', '3']]);

    const conflict = { ok: false, error: 'conflict', message: COPY.CONFLICT };
    // Without the updatedAt he saw, the accept goes by the proposal's own: the row changed since.
    expect(await accept(deps, { proposalId: made.proposalId })).toEqual(conflict);
    expect(await accept(deps, { proposalId: stageMade.proposalId })).toEqual(conflict);
    // The row changes again after he opened the page.
    deps.clock = () => later(2);
    await change(deps, { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'SECRET other' } });
    expect(await accept(deps, { proposalId: made.proposalId, expectedUpdatedAt: seen.targetUpdatedAt })).toEqual(conflict);
    expect(await accept(deps, { proposalId: stageMade.proposalId, expectedUpdatedAt: seen.targetUpdatedAt })).toEqual(conflict);
    expect((await book(deps)).partners.find((p) => p.id === partnerId)!.desk.credibility).toBe(1);
    expect([indexOf(deps, made.proposalId).status, indexOf(deps, stageMade.proposalId).status]).toEqual(['waiting', 'waiting']);
    expect((await book(deps)).proposalItems.map((i) => i.status)).toEqual(['waiting', 'waiting']);

    // With the updatedAt he sees now, it is accepted.
    const now = (await viewOf(deps, made.proposalId))!.targetUpdatedAt;
    expect(value(await accept(deps, { proposalId: made.proposalId, expectedUpdatedAt: now })).status).toBe('accepted');
    expect((await book(deps)).partners.find((p) => p.id === partnerId)!.desk.credibility).toBe(3);
    const stageNow = (await viewOf(deps, stageMade.proposalId))!.targetUpdatedAt;
    expect(value(await accept(deps, { proposalId: stageMade.proposalId, expectedUpdatedAt: stageNow })).book.value.partners[0]!.step).toBe('discovery_call');
  });

  it('accepting a proposal whose partner type was removed is refused with its message, and rejecting it works', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const other = await addPartner(deps, 'SECRET Beta');
    const made = value(await propose(deps, claude, stage(partnerId)));
    const onClosed = value(await propose(deps, claude, stage(other.partnerId)));
    await change(deps, { kind: 'delete', entity: 'partner', id: partnerId });
    await change(deps, { kind: 'close', partnerId: other.partnerId, as: 'no', reason: 'SECRET no fit' });

    expect(await accept(deps, { proposalId: made.proposalId })).toEqual({ ok: false, error: 'invalid', message: COPY.GONE });
    expect(await accept(deps, { proposalId: onClosed.proposalId })).toEqual({ ok: false, error: 'invalid', message: COPY.REOPEN_BEFORE_STEP });
    expect(indexOf(deps, made.proposalId).status).toBe('waiting');

    const out = value(await reject(deps, { proposalId: made.proposalId, note: 'SECRET gone' }));
    expect(out.book.value.proposalItems.filter((i) => i.proposalId === made.proposalId).map((i) => [i.status, i.answerNote]))
      .toEqual([['rejected', 'SECRET gone']]);
    expect(indexOf(deps, made.proposalId)).toMatchObject({ status: 'rejected', answeredAt: TEST_NOW });
    value(await reject(deps, { proposalId: onClosed.proposalId }));
    expect(indexOf(deps, onClosed.proposalId).status).toBe('rejected');
  });

  it('accepting new partners runs the preview on the file as it is now and marks the unticked companies rejected', async () => {
    const deps = await setup();
    const { marketId, hypothesisId } = await addMarket(deps);
    for (const name of ['Linked1', 'Linked2']) {
      const p = await addPartner(deps, `SECRET ${name}`, 'reseller', `${name.toLowerCase()}.example`);
      await change(deps, { kind: 'add', entity: 'marketLink', values: { partnerId: p.partnerId, marketId } });
    }
    await addPartner(deps, 'SECRET Existing', 'reseller', 'existing.example');
    await addPartner(deps, 'SECRET Other', 'distributor', 'other.example');
    value(await changeMarket(deps, ruth, { marketId, change: { kind: 'add', entity: 'exclusion', values: { company: 'SECRET Excluded', website: '', reason: 'no' } } }));
    const companies = [
      company('SECRET Linked1', 'linked1.example'), company('SECRET Linked2', 'linked2.example'), company('SECRET Existing', 'existing.example'),
      company('SECRET Other', 'other.example'), company('SECRET Excluded'), company('SECRET Late', 'late.example'),
      ...Array.from({ length: 6 }, (_, i) => company(`SECRET New ${i}`, `new${i}.example`)),
    ];
    const made = value(await propose(deps, claude, { kind: 'partners', marketId, hypothesisId, companies, reason: 'SECRET reason' }));
    expect(made.alreadyPartners).toEqual([0, 1, 2, 3]);
    // Ruth adds one of them by hand before they accept.
    const late = await addPartner(deps, 'SECRET Late', 'reseller', 'late.example');
    await change(deps, { kind: 'add', entity: 'marketLink', values: { partnerId: late.partnerId, marketId } });
    const partnersBefore = (await book(deps)).partners.length;

    // He ticks the six new ones, the other type, and the late one (the preview he saw was older).
    const out = value(await accept(deps, { proposalId: made.proposalId, ticked: [3, 5, 6, 7, 8, 9, 10, 11] }));

    expect(out.status).toBe('partly_accepted');
    const after = out.book.value;
    expect(after.partners).toHaveLength(partnersBefore + 7);
    expect(after.accounts.filter((a) => a.company === 'SECRET Late')).toHaveLength(1);
    expect(after.accounts.filter((a) => a.company === 'SECRET Other')).toHaveLength(1);
    const added = after.partners.filter((p) => p.updatedBy === PROPOSED_BY);
    expect(added).toHaveLength(7);
    expect(added.every((p) => p.source === 'ai_search' && p.partnerType === 'reseller')).toBe(true);
    expect(after.marketLinks.filter((l) => l.marketId === marketId)).toHaveLength(3 + 7);
    expect((await itemsOf(deps, made.proposalId)).map((i) => [i.proposed, i.status])).toEqual(companies.map((c, i) =>
      [c.company, [3, 6, 7, 8, 9, 10, 11].includes(i) ? 'accepted' : 'rejected']));
    expect(indexOf(deps, made.proposalId).status).toBe('partly_accepted');
    expect(await viewOf(deps, made.proposalId, marketId)).toMatchObject({ state: 'answered', answeredLine: 'Accepted 7 of 12' });
  });

  it('accepting 50 new companies is one write, past the 100-change cap of a parsed batch', async () => {
    const deps = await setup();
    const { marketId, hypothesisId } = await addMarket(deps);
    const companies = Array.from({ length: 50 }, (_, i) => company(`SECRET Co ${i}`, `co${i}.example`));
    const made = value(await propose(deps, claude, { kind: 'partners', marketId, hypothesisId, companies, reason: 'SECRET reason' }));
    let writes = 0;
    const applyMany = deps.partnerBooks.applyMany.bind(deps.partnerBooks);
    deps.partnerBooks.applyMany = async (...args) => { writes += 1; expect(args[1]).toHaveLength(200); return applyMany(...args); };
    const out = value(await accept(deps, { proposalId: made.proposalId }));
    expect(writes).toBe(1);
    expect(out.status).toBe('accepted');
    expect(out.book.value.partners).toHaveLength(50);
    expect((await itemsOf(deps, made.proposalId)).every((i) => i.status === 'accepted')).toBe(true);
  });

  it('ticking no company that can be added is refused, and nothing changes', async () => {
    const deps = await setup();
    const { marketId, hypothesisId } = await addMarket(deps);
    const made = value(await propose(deps, claude, { kind: 'partners', marketId, hypothesisId, companies: [company('SECRET New')], reason: 'SECRET reason' }));
    expect(await accept(deps, { proposalId: made.proposalId, ticked: [] })).toEqual({
      ok: false, error: 'invalid', message: COPY.IMPORT_NOTHING_TICKED, fieldErrors: { ticked: COPY.IMPORT_NOTHING_TICKED },
    });
    expect(await accept(deps, { proposalId: made.proposalId, ticked: [4] })).toMatchObject({ ok: false, error: 'invalid' });
    expect(indexOf(deps, made.proposalId).status).toBe('waiting');
    // Letters, a signed date or ticks that don't fit the kind are invalid too.
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const fourMade = value(await propose(deps, claude, letterOnly(partnerId, 2)));
    expect(await accept(deps, { proposalId: fourMade.proposalId, letters: ['commitment'] })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await accept(deps, { proposalId: fourMade.proposalId, shiftMapDates: true })).toMatchObject({ ok: false, error: 'invalid' });
    expect(indexOf(deps, fourMade.proposalId).status).toBe('waiting');
  });

  it('another person’s proposal id is not found for accept and reject', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    const gone = { ok: false, error: 'not_found', message: COPY.GONE };
    expect(await acceptProposal(deps, ben, { companyId: BEN_CO, proposalId: made.proposalId })).toEqual(gone);
    expect(await rejectProposal(deps, ben, { companyId: BEN_CO, proposalId: made.proposalId })).toEqual(gone);
    // Naming Ruth's company: refused before anything is read.
    expect(await acceptProposal(deps, ben, { companyId: CO, proposalId: made.proposalId })).toEqual(FORBIDDEN);
    expect(indexOf(deps, made.proposalId).status).toBe('waiting');
    expect((await itemsOf(deps, made.proposalId)).map((i) => i.status)).toEqual(['waiting']);
  });

  it('an accept that Google refuses leaves the proposal waiting', async () => {
    const deps = await setup();
    await deps.webhooks.create({ userId: 'u_bern', url: 'https://hooks.example.com/in', events: ['proposal.answered'] });
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, fourC(partnerId)));
    const read = deps.partnerBooks.read.bind(deps.partnerBooks);
    deps.partnerBooks.applyMany = async () => ({ ok: false, error: 'auth', message: 'Reconnect' });
    expect(await accept(deps, { proposalId: made.proposalId })).toEqual({ ok: false, error: 'auth', message: 'Reconnect' });
    expect(await reject(deps, { proposalId: made.proposalId })).toEqual({ ok: false, error: 'auth', message: 'Reconnect' });
    deps.partnerBooks.read = async () => ({ ok: false, error: 'auth', message: 'Reconnect' });
    expect(await accept(deps, { proposalId: made.proposalId })).toEqual({ ok: false, error: 'auth', message: 'Reconnect' });
    deps.partnerBooks.read = read;
    expect(indexOf(deps, made.proposalId).status).toBe('waiting');
    expect((await itemsOf(deps, made.proposalId)).map((i) => i.status)).toEqual(['waiting', 'waiting', 'waiting', 'waiting']);
    expect((await book(deps)).partners.find((p) => p.id === partnerId)!.desk).toEqual({ customerBase: null, credibility: null, capability: null, commitment: null });
    expect(deps.webhooks.deliveries).toEqual([]);
  });

  it('a signed proposal accepted with shiftMapDates moves the MAP’s open dates and sends partner.signed', async () => {
    const deps = await setup();
    const signedHook = await deps.webhooks.create({ userId: 'u_bern', url: 'https://hooks.example.com/in', events: ['partner.signed'] });
    const { accountId, partnerId } = await addPartner(deps, 'SECRET Acme');
    const { mapId } = value(await startMap(deps, ruth, { companyId: CO, partnerId }));
    const activityId = value(await changeMap(deps, ruth, {
      mapId, change: { kind: 'add', entity: 'activity', values: { title: 'SECRET task', side: 'us', dueDate: '2026-11-10' } },
    })).entityId!;
    const made = value(await propose(deps, claude, { kind: 'signed', partnerId, expectedUpdatedAt: TEST_NOW, signedDate: '2026-11-05', reason: 'SECRET reason' }));
    deps.webhooks.deliveries.length = 0;

    // The sign dialog's date wins over the proposal's.
    const out = value(await accept(deps, { proposalId: made.proposalId, signedDate: '2026-11-07', shiftMapDates: true }));

    expect(out).toMatchObject({ status: 'accepted', mapDates: { moved: true, days: 10 } });
    expect(out.book.value.partners.find((p) => p.id === partnerId)).toMatchObject({ signedDate: '2026-11-07', stage: 'onboarding', updatedBy: PROPOSED_BY });
    const map = value(await readMap(deps, ruth, { mapId }));
    expect(map.value.activities.find((a) => a.id === activityId)!.dueDate).toBe('2026-11-20');
    expect(deps.webhooks.deliveries.map((d) => [d.webhookId, d.type, d.data])).toEqual([
      [signedHook.webhook.id, 'partner.signed', { accountId, partnerId, mapId }],
    ]);
  });

  it('a market status accept writes the market file, then the row, then the index; when the row write fails, the next view says already and accepting closes it', async () => {
    const deps = await setup();
    const { marketId, hypothesisId } = await addMarket(deps);
    const made = value(await propose(deps, claude, { kind: 'marketStatus', marketId, expectedUpdatedAt: null, to: 'validated', note: 'SECRET note', reason: 'SECRET reason' }));
    const order: string[] = [];
    const marketApply = deps.markets.apply.bind(deps.markets);
    deps.markets.apply = async (...args) => { order.push('market'); return marketApply(...args); };
    const applyMany = deps.partnerBooks.applyMany.bind(deps.partnerBooks);
    deps.partnerBooks.applyMany = async (...args) => { order.push('rows'); return applyMany(...args); };
    const answer = deps.proposals.answer.bind(deps.proposals);
    deps.proposals.answer = async (...args) => { order.push('index'); return answer(...args); };

    const out = value(await accept(deps, { proposalId: made.proposalId }));

    expect(order).toEqual(['market', 'rows', 'index']);
    expect(out.status).toBe('accepted');
    expect(out.market!.value.info).toMatchObject({ status: 'validated', statusNote: 'SECRET note', updatedBy: PROPOSED_BY });
    expect((await itemsOf(deps, made.proposalId)).map((i) => i.status)).toEqual(['accepted']);
    expect(indexOf(deps, made.proposalId).status).toBe('accepted');

    // A hypothesis status whose rows' write fails: the market has it, the proposal still waits.
    const hyp = value(await propose(deps, claude, { kind: 'hypothesisStatus', marketId, hypothesisId, expectedUpdatedAt: TEST_NOW, to: 'holds', reason: 'SECRET reason' }));
    deps.partnerBooks.applyMany = async () => ({ ok: false, error: 'unavailable', message: 'Google is busy' });
    expect(await accept(deps, { proposalId: hyp.proposalId })).toEqual({ ok: false, error: 'unavailable', message: 'Google is busy' });
    expect(value(await readMarket(deps, ruth, { marketId })).value.hypotheses[0]!.status).toBe('holds');
    expect(indexOf(deps, hyp.proposalId).status).toBe('waiting');
    expect(await viewOf(deps, hyp.proposalId, marketId)).toMatchObject({ state: 'already' });

    deps.partnerBooks.applyMany = applyMany;
    order.length = 0;
    expect(value(await accept(deps, { proposalId: hyp.proposalId })).status).toBe('accepted');
    expect(order).toEqual(['index']);
    expect((await itemsOf(deps, hyp.proposalId)).map((i) => i.status)).toEqual(['accepted']);
    expect(indexOf(deps, hyp.proposalId).status).toBe('accepted');
  });

  it('a partner kind already as proposed closes as accepted without writing the change again', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    deps.clock = () => later(1);
    await change(deps, { kind: 'setStep', partnerId, to: 'discovery_call' });
    expect(await viewOf(deps, made.proposalId)).toMatchObject({ state: 'already' });
    deps.events.events.length = 0;
    deps.clock = () => later(2);

    const out = value(await accept(deps, { proposalId: made.proposalId }));
    const commands = deps.events.events.map((e) => e.command);

    expect(out.status).toBe('accepted');
    expect(commands).toEqual(['proposals.accept']);
    expect(out.book.value.partners.find((p) => p.id === partnerId)).toMatchObject({ step: 'discovery_call', updatedAt: later(1), updatedBy: 'Ruth' });
    expect((await itemsOf(deps, made.proposalId)).map((i) => i.status)).toEqual(['accepted']);
  });

  it('an accept and the agent’s withdraw at once: exactly one of them wins, and the tab and the index agree', async () => {
    const deps = await setup();
    deps.partnerBooks = serializeApplies(deps.partnerBooks, new MemoryFileLock());
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    const [accepted, withdrawn] = await Promise.all([
      accept(deps, { proposalId: made.proposalId }), withdrawProposal(deps, claude, { companyId: CO, proposalId: made.proposalId }),
    ]);
    expect([accepted.ok, withdrawn.ok].filter(Boolean)).toHaveLength(1);
    const status = indexOf(deps, made.proposalId).status;
    expect((await itemsOf(deps, made.proposalId)).map((i) => i.status)).toEqual([status]);
  });

  it('an agent may not accept or reject, even at propose', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    for (const actor of [claude, app('Claude', 'c_claude_1', 'change'), key(), key('read')]) {
      expect(await accept(deps, { proposalId: made.proposalId }, actor)).toEqual(FORBIDDEN);
      expect(await reject(deps, { proposalId: made.proposalId }, actor)).toEqual(FORBIDDEN);
    }
    expect(indexOf(deps, made.proposalId).status).toBe('waiting');
  });

  it('a proposal of a turned-off agent can still be accepted', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, stage(partnerId)));
    const byKey = value(await propose(deps, key(), fourC(partnerId)));
    deps.proposals.turnOffApp('u_bern', 'c_claude_1');
    deps.proposals.turnOffKey('u_bern', 'k_n8n');
    expect(await viewOf(deps, made.proposalId)).toMatchObject({ head: { makerOn: false }, state: 'waiting' });
    expect(value(await accept(deps, { proposalId: made.proposalId })).status).toBe('accepted');
    expect(value(await reject(deps, { proposalId: byKey.proposalId })).book.value.proposalItems.filter((i) => i.proposalId === byKey.proposalId)
      .map((i) => i.updatedBy)).toEqual(Array(4).fill('Ruth, proposed by Desk Agent'));
  });

  it('when two agents proposed the same score, accepting one shows the other as changed since', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const byClaude = value(await propose(deps, claude, letterOnly(partnerId, 3)));
    const byCursor = value(await propose(deps, app('Cursor', 'c_cursor'), letterOnly(partnerId, 2)));
    const byKey = value(await propose(deps, key(), letterOnly(partnerId, 3)));
    deps.clock = () => later(1);
    value(await accept(deps, { proposalId: byClaude.proposalId }));
    expect(await viewOf(deps, byCursor.proposalId)).toMatchObject({ state: 'changed', targetUpdatedAt: later(1) });
    // The same value as the one accepted: it is so already, and accepting closes it.
    expect(await viewOf(deps, byKey.proposalId)).toMatchObject({ state: 'already' });
    expect(value(await accept(deps, { proposalId: byKey.proposalId })).status).toBe('accepted');
    // The other one is accepted with the updatedAt the person sees.
    expect(value(await accept(deps, { proposalId: byCursor.proposalId, expectedUpdatedAt: later(1) })).status).toBe('accepted');
    expect((await book(deps)).partners.find((p) => p.id === partnerId)!.desk.credibility).toBe(2);
  });

  it('proposal.answered goes out on accept and on reject, never on withdraw, replace or expiry', async () => {
    const deps = await setup();
    const hook = await deps.webhooks.create({ userId: 'u_bern', url: 'https://hooks.example.com/in', events: ['proposal.answered'] });
    const { accountId, partnerId } = await addPartner(deps, 'SECRET Acme');
    const { marketId, hypothesisId } = await addMarket(deps);
    const accepted = value(await propose(deps, claude, fourC(partnerId)));
    const rejected = value(await propose(deps, claude, { kind: 'hypothesisStatus', marketId, hypothesisId, expectedUpdatedAt: TEST_NOW, to: 'holds', reason: 'SECRET reason' }));
    value(await accept(deps, { proposalId: accepted.proposalId }));
    value(await reject(deps, { proposalId: rejected.proposalId, note: 'SECRET not yet' }));
    const withdrawn = value(await propose(deps, claude, stage(partnerId)));
    value(await withdrawProposal(deps, claude, { companyId: CO, proposalId: withdrawn.proposalId }));
    value(await propose(deps, claude, stage(partnerId)));
    value(await propose(deps, claude, { ...stage(partnerId), reason: 'SECRET again' }));
    await deps.proposals.expire(later(31));
    expect(deps.webhooks.deliveries.map((d) => [d.webhookId, d.type, d.data])).toEqual([
      [hook.webhook.id, 'proposal.answered', { proposalId: accepted.proposalId, kind: 'fourC', accountId, partnerId }],
      [hook.webhook.id, 'proposal.answered', { proposalId: rejected.proposalId, kind: 'hypothesisStatus', marketId, hypothesisId }],
    ]);
  });

  it('the event of an accepted change has actorKind owner and the proposal id', async () => {
    const deps = await setup();
    const logs: unknown[] = [];
    deps.log = (event, ids) => { logs.push([event, ids]); };
    const { accountId, partnerId } = await addPartner(deps, 'SECRET Acme');
    const { marketId, hypothesisId } = await addMarket(deps);
    const made = value(await propose(deps, claude, fourC(partnerId)));
    const status = value(await propose(deps, claude, { kind: 'marketStatus', marketId, expectedUpdatedAt: null, to: 'validated', note: 'SECRET note', reason: 'SECRET reason' }));
    const partners = value(await propose(deps, claude, { kind: 'partners', marketId, hypothesisId, companies: [company('SECRET New')], reason: 'SECRET reason' }));
    const rejected = value(await propose(deps, claude, stage(partnerId)));
    const fileId = (await deps.directory.partnerBook(CO))!.fileId;
    deps.events.events.length = 0;

    value(await accept(deps, { proposalId: made.proposalId, letters: ['credibility'] }));
    value(await accept(deps, { proposalId: status.proposalId }));
    value(await accept(deps, { proposalId: partners.proposalId }));
    value(await reject(deps, { proposalId: rejected.proposalId, note: 'SECRET why not' }));

    const events = deps.events.events.map(({ command, actorKind, entityIds, change: c, proposalId, fileId: f }) => ({ command, actorKind, entityIds, change: c, proposalId, fileId: f }));
    expect(events).toEqual([
      { command: 'partners.change', actorKind: 'owner', entityIds: [partnerId], change: 'update', proposalId: made.proposalId, fileId },
      { command: 'proposals.accept', actorKind: 'owner', entityIds: [made.proposalId, accountId, partnerId], change: 'partly_accepted', proposalId: made.proposalId, fileId },
      expect.objectContaining({ command: 'markets.change', actorKind: 'owner', proposalId: status.proposalId }),
      { command: 'proposals.accept', actorKind: 'owner', entityIds: [status.proposalId, marketId], change: 'accepted', proposalId: status.proposalId, fileId },
      expect.objectContaining({ command: 'partners.import', actorKind: 'owner', proposalId: partners.proposalId, fileId }),
      { command: 'proposals.accept', actorKind: 'owner', entityIds: [partners.proposalId, marketId, hypothesisId], change: 'accepted', proposalId: partners.proposalId, fileId },
      { command: 'proposals.reject', actorKind: 'owner', entityIds: [rejected.proposalId, accountId, partnerId], change: 'rejected', proposalId: rejected.proposalId, fileId },
    ]);
    const stored = JSON.stringify({ index: deps.proposals.rows, events: deps.events.events, logs });
    expect(stored).not.toContain('SECRET');
    expect(stored).not.toMatch(/score|evidence|reason|letters|companies|note|Ruth|Claude for|proposed by/i);
  });
});

describe('rejectProposal', () => {
  it('marks every row Rejected with the note, in the tab only', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const made = value(await propose(deps, claude, fourC(partnerId)));
    const out = value(await reject(deps, { proposalId: made.proposalId, note: 'SECRET not before the call' }));
    expect(out.book.value.proposalItems.map((i) => [i.status, i.answerNote, i.answeredOn, i.updatedBy]))
      .toEqual(Array(4).fill(['rejected', 'SECRET not before the call', TEST_NOW, PROPOSED_BY]));
    expect(out.book.value.partners.find((p) => p.id === partnerId)!.desk.credibility).toBeNull();
    expect(indexOf(deps, made.proposalId)).toMatchObject({ status: 'rejected', answeredAt: TEST_NOW });
    expect(await reject(deps, { proposalId: made.proposalId, note: 'x'.repeat(2001) })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('an expired, withdrawn or replaced proposal can’t be answered', async () => {
    const deps = await setup();
    const { partnerId } = await addPartner(deps, 'SECRET Acme');
    const expired = value(await propose(deps, claude, fourC(partnerId)));
    const withdrawn = value(await propose(deps, claude, stage(partnerId)));
    value(await withdrawProposal(deps, claude, { companyId: CO, proposalId: withdrawn.proposalId }));
    const replaced = value(await propose(deps, app('Cursor', 'c_cursor'), stage(partnerId)));
    value(await propose(deps, app('Cursor', 'c_cursor'), { ...stage(partnerId), reason: 'SECRET newer' }));

    expect(await accept(deps, { proposalId: withdrawn.proposalId })).toEqual({ ok: false, error: 'conflict', message: 'Desk Agent took this proposal back.' });
    expect(await reject(deps, { proposalId: replaced.proposalId })).toEqual({ ok: false, error: 'conflict', message: 'Desk Agent sent a newer proposal instead.' });
    deps.clock = () => later(30);
    const gone = { ok: false, error: 'invalid', message: COPY.PROPOSAL_EXPIRED };
    expect(await accept(deps, { proposalId: expired.proposalId })).toEqual(gone);
    expect(await reject(deps, { proposalId: expired.proposalId })).toEqual(gone);
    await deps.proposals.expire(later(30));
    expect(await accept(deps, { proposalId: expired.proposalId })).toEqual(gone);
    expect(indexOf(deps, expired.proposalId).status).toBe('expired');
  });
});
