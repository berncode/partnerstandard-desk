import { sortNotes, type MapPlan, type PartnerBook } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { describe, expect, it } from 'vitest';
import { DECISION_CHANGES, DECISION_COMMANDS, OWNER_ONLY_COMMANDS, type CommandName } from '../access';
import type { Actor, AgentActor, AgentLevel } from '../actor';
import { createCase, readCase } from '../cases';
import { changeMap, readMap, startMap } from '../maps';
import { changeMarket, createMarket, readMarket } from '../markets';
import { changePartner, readPartners } from '../partners';
import { createProgram, readCompanyFacts } from '../programs';
import { makeTestDeps } from '../testing';
import { agentContext, type AgentContext } from './context';
import { AGENT_TOOLS, findTool, runTool } from './tools';

const ANNA_CO = 'co_aaaaaaaaaa';
const BEN_CO = 'co_bbbbbbbbbb';
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const ben: Actor = { kind: 'owner', userId: 'u_ben', displayName: 'Ben' };
/** Signed on this day, the first horizon's review is coming up on TEST_NOW (as in reviews.test.ts). */
const SIGNED = '2026-08-15';
const LATER = '2026-10-28T11:00:00.000Z';

type TestDeps = ReturnType<typeof makeTestDeps>;

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function setup(level: AgentLevel = 'change') {
  const deps = makeTestDeps({ companies: { u_anna: ANNA_CO, u_ben: BEN_CO } });
  for (const [actor, companyId] of [[anna, ANNA_CO], [ben, BEN_CO]] as const) {
    await readPartners(deps, actor, { companyId });
    await readCompanyFacts(deps, actor, { companyId });
  }
  const ctx = await agentContext(deps, { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
  return { deps, ctx };
}

const partnerChange = async (deps: TestDeps, actor: Actor, companyId: string, change: Record<string, unknown>) =>
  value(await changePartner(deps, actor, { companyId, change }));
const mapChange = async (deps: TestDeps, actor: Actor, mapId: string, change: Record<string, unknown>) =>
  value(await changeMap(deps, actor, { mapId, change })).entityId!;

/** Makes a store's `apply` throw on its `nth` call from now (a database or Google failure the command doesn't catch). */
function throwOnApply(store: { apply: (...args: never[]) => unknown }, nth: number) {
  const apply = store.apply.bind(store) as (...args: unknown[]) => unknown;
  let calls = 0;
  (store as { apply: (...args: unknown[]) => unknown }).apply = (...args: unknown[]) => {
    calls++;
    if (calls === nth) throw new Error('SECRET store failure');
    return apply(...args);
  };
}

/** The log lines a test's deps write. */
function logged(deps: TestDeps) {
  const lines: Array<{ event: string; ids: Record<string, string> }> = [];
  deps.log = (event, ids) => { lines.push({ event, ids }); };
  return lines;
}

/**
 * A signed reseller with a contact, a MAP (a person, a milestone, an activity due in the first horizon), a market with
 * a hypothesis, and a business case.
 */
async function withEverything(deps: TestDeps, actor: Actor, companyId: string, company = 'Acme') {
  const accountId = (await partnerChange(deps, actor, companyId, { kind: 'add', entity: 'account', values: { company } })).entityId!;
  const partnerId = (await partnerChange(deps, actor, companyId, {
    kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller', whyItFits: 'SECRET why it fits' },
  })).entityId!;
  const contactId = (await partnerChange(deps, actor, companyId, {
    kind: 'add', entity: 'person', values: { accountId, name: 'Lena Ortiz', role: 'contact' },
  })).entityId!;
  const { mapId } = value(await startMap(deps, actor, { companyId, partnerId }));
  const personId = await mapChange(deps, actor, mapId, { kind: 'add', entity: 'person', values: { side: 'us', name: 'Ben Ito', role: 'other' } });
  const milestoneId = await mapChange(deps, actor, mapId, { kind: 'add', entity: 'milestone', values: { name: 'First deal' } });
  const activityId = await mapChange(deps, actor, mapId, {
    kind: 'add', entity: 'activity', values: { title: 'SECRET open task', side: 'partner', dueDate: '2026-09-01' },
  });
  await partnerChange(deps, actor, companyId, { kind: 'markSigned', partnerId, signedDate: SIGNED });
  const { marketId } = value(await createMarket(deps, actor, {
    companyId, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
  }));
  const hypothesisId = value(await changeMarket(deps, actor, {
    marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'SECRET agencies' } },
  })).entityId!;
  const { programId } = value(await createProgram(deps, actor, { companyId, partnerType: 'reseller', from: 'fresh' }));
  await partnerChange(deps, actor, companyId, { kind: 'update', entity: 'partner', id: partnerId, patch: { programId } });
  const { caseId } = value(await createCase(deps, actor, { companyId, partnerId }));
  deps.events.events.length = 0;
  return { accountId, partnerId, contactId, mapId, personId, milestoneId, activityId, marketId, hypothesisId, caseId };
}

type Fixture = Awaited<ReturnType<typeof withEverything>>;

const bookOf = async (deps: TestDeps, actor: Actor = anna, companyId = ANNA_CO): Promise<PartnerBook> =>
  value(await readPartners(deps, actor, { companyId })).value;
const planOf = async (deps: TestDeps, mapId: string, actor: Actor = anna): Promise<MapPlan> => value(await readMap(deps, actor, { mapId })).value;

/** What the files hold, to check that a refused change wrote nothing. */
async function files(deps: TestDeps, f: Fixture) {
  const events = deps.events.events.length;
  const out = {
    book: await bookOf(deps), plan: await planOf(deps, f.mapId), market: value(await readMarket(deps, anna, { marketId: f.marketId })).value,
    case: value(await readCase(deps, anna, { caseId: f.caseId })).value, facts: value(await readCompanyFacts(deps, anna, { companyId: ANNA_CO })).value,
  };
  deps.events.events.length = events;
  return out;
}

/** Each change tool with an input it accepts (read fresh, so its expectedUpdatedAt is current), and the commands it may run. */
const CHANGES: Record<string, { input: (deps: TestDeps, f: Fixture) => Promise<Record<string, unknown>>; commands: CommandName[] }> = {
  log_call: {
    input: async (_d, f) => ({ accountId: f.accountId, partnerType: 'reseller', date: '2026-10-27', kind: 'follow_up', notes: 'SECRET call' }),
    commands: ['partners.read', 'partners.change'],
  },
  update_partner: {
    input: async (deps, f) => {
      const book = await bookOf(deps);
      return { accountId: f.accountId, account: { expectedUpdatedAt: book.accounts[0]!.updatedAt, website: 'https://acme.example' } };
    },
    commands: ['partners.read', 'partners.change'],
  },
  add_activity: { input: async (_d, f) => ({ mapId: f.mapId, title: 'SECRET kickoff', side: 'joint' }), commands: ['maps.change'] },
  update_activity: {
    input: async (deps, f) => {
      const plan = await planOf(deps, f.mapId);
      const activity = plan.activities.find((a) => a.id === f.activityId)!;
      return { mapId: f.mapId, activityId: f.activityId, expectedUpdatedAt: activity.updatedAt, status: 'in_progress' };
    },
    commands: ['maps.change'],
  },
  update_milestone: { input: async (_d, f) => ({ mapId: f.mapId, milestoneId: f.milestoneId, targetDate: '2026-12-01' }), commands: ['maps.change'] },
  prepare_review: {
    input: async (_d, f) => ({ mapId: f.mapId, commitments: [{ title: 'SECRET webinar', side: 'joint' }] }),
    commands: ['reviews.open', 'reviews.read', 'maps.change'],
  },
  update_market: {
    input: async (deps, f) => {
      const market = value(await readMarket(deps, anna, { marketId: f.marketId })).value;
      return { marketId: f.marketId, market: { expectedUpdatedAt: market.info.updatedAt, statement: 'SECRET statement' } };
    },
    commands: ['markets.change'],
  },
  update_case: {
    input: async (deps, f) => {
      const c = value(await readCase(deps, anna, { caseId: f.caseId })).value;
      return { caseId: f.caseId, expectedUpdatedAt: c.updatedAt, case: { title: 'Agent case' } };
    },
    commands: ['cases.read', 'cases.save'],
  },
  save_company_facts: {
    input: async (deps) => {
      const facts = value(await readCompanyFacts(deps, anna, { companyId: ANNA_CO })).value;
      return { expectedUpdatedAt: facts.updatedAt, facts: { yearly: 12000 } };
    },
    commands: ['companyFacts.read', 'companyFacts.save'],
  },
  add_webhook: { input: async () => ({ url: 'https://hooks.example.com/in', events: ['partner.signed'] }), commands: ['webhooks.create'] },
  delete_webhook: {
    input: async (deps) => {
      const made = await deps.webhooks.create({ userId: 'u_anna', url: 'https://hooks.example.com/in', events: ['review.due'] });
      return { webhookId: made.webhook.id };
    },
    commands: ['webhooks.delete'],
  },
};

describe('the change tools', () => {
  it('are the ones of spec 5.2 and the webhook ones of spec 7.1, at level change, never GET', () => {
    const change = AGENT_TOOLS.filter((t) => t.level === 'change');
    expect(change.map((t) => t.name).sort()).toEqual(Object.keys(CHANGES).sort());
    for (const t of change) expect(t.rest.method).not.toBe('GET');
  });

  it('no change tool\'s command is in DECISION_COMMANDS or OWNER_ONLY_COMMANDS', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    // Run as Anna herself: a person's commands record their events, reads too, so the events name every command a
    // tool ran. A tool that ran a decision would succeed for her and show it here.
    const asOwner: AgentContext = { ...ctx, actor: anna as unknown as AgentActor };
    for (const [name, { input, commands }] of Object.entries(CHANGES)) {
      const tool = findTool(name)!;
      const sent = await input(deps, f);
      deps.events.events.length = 0;
      const result = await tool.run(asOwner, tool.input.parse(sent));
      expect({ name, result: result.ok ? 'ok' : result }).toEqual({ name, result: 'ok' });
      expect({ name, events: deps.events.events.length > 0 }).toEqual({ name, events: true });
      for (const e of deps.events.events) {
        expect({ name, command: e.command, allowed: commands.includes(e.command) }).toEqual({ name, command: e.command, allowed: true });
        expect(DECISION_COMMANDS).not.toContain(e.command);
        expect(OWNER_ONLY_COMMANDS).not.toContain(e.command);
        if (e.change !== undefined) expect(DECISION_CHANGES as readonly string[]).not.toContain(e.change);
      }
    }
  });

  it('each change tool runs for a change agent and stamps "Desk Agent for Anna"', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const events: typeof deps.events.events = [];
    for (const [name, { input }] of Object.entries(CHANGES)) {
      const sent = await input(deps, f);
      deps.events.events.length = 0;
      const result = await runTool(ctx, name, sent);
      expect({ name, result: result.ok ? 'ok' : result }).toEqual({ name, result: 'ok' });
      events.push(...deps.events.events);
    }
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e).toMatchObject({ actorKind: 'agent', actorUserId: 'u_anna' });
    const now = await files(deps, f);
    expect(now.book.accounts[0]!.updatedBy).toBe('Desk Agent for Anna');
    expect(now.book.calls[0]!.updatedBy).toBe('Desk Agent for Anna');
    expect(now.plan.activities.find((a) => a.id === f.activityId)!.updatedBy).toBe('Desk Agent for Anna');
    expect(now.market.info.updatedBy).toBe('Desk Agent for Anna');
  });

  it('a change tool records its change event with ids only', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const notes = 'Revenue Model\nSECRET subscriptions\n\nSECRET other words';
    const logged = value(await runTool(ctx, 'log_call', { accountId: f.accountId, partnerType: 'reseller', date: '2026-10-27', kind: 'discovery', notes })) as { call: { id: string } };
    expect(deps.events.events).toHaveLength(1);
    const [event] = deps.events.events;
    expect(event).toMatchObject({ command: 'partners.change', actorKind: 'agent', actorUserId: 'u_anna', entityIds: [logged.call.id], change: 'add' });
    expect(JSON.stringify(deps.events.events)).not.toContain('SECRET');
  });
});

describe('another person\'s ids (Review Focus 1)', () => {
  it('update_partner, update_market and update_case answer Ben\'s ids as missing ones, and write nothing', async () => {
    const { deps, ctx } = await setup();
    await withEverything(deps, anna, ANNA_CO);
    const bens = await withEverything(deps, ben, BEN_CO, 'Bens Partner');
    deps.events.events.length = 0;
    const at = '2026-10-28T10:00:00.000Z';
    const pairs: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['update_partner', { accountId: bens.accountId, addContacts: [{ name: 'Tom' }] }, { accountId: 'ac_missing', addContacts: [{ name: 'Tom' }] }],
      ['update_market', { marketId: bens.marketId, market: { expectedUpdatedAt: at, statement: 'x' } }, { marketId: 'mk_missing', market: { expectedUpdatedAt: at, statement: 'x' } }],
      ['update_case', { caseId: bens.caseId, expectedUpdatedAt: at, case: { title: 'x' } }, { caseId: 'cs_missing', expectedUpdatedAt: at, case: { title: 'x' } }],
    ];
    for (const [name, theirs, missing] of pairs) {
      const answer = await runTool(ctx, name, theirs);
      expect({ name, ok: answer.ok }).toEqual({ name, ok: false });
      expect({ name, answer }).toEqual({ name, answer: await runTool(ctx, name, missing) });
    }
    expect(deps.events.events).toEqual([]);
    expect((await bookOf(deps, ben, BEN_CO)).people.map((p) => p.name)).toEqual(['Lena Ortiz']);
    expect(value(await readCase(deps, ben, { caseId: bens.caseId })).value.title).not.toBe('x');
    expect(value(await readMarket(deps, ben, { marketId: bens.marketId })).value.info.statement).not.toBe('x');
  });
});

describe('log_call', () => {
  it('log_call sorts discovery notes into the six topics like sortNotes and stamps "Desk Agent for Anna"', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const notes = [
      '## Revenue Model', 'Subscriptions, yearly.', '', '**Customer Pains:** slow onboarding', 'and long setups', '',
      '## Next steps', 'Send the deck.',
    ].join('\n');
    const answer = value(await runTool(ctx, 'log_call', { accountId: f.accountId, partnerType: 'reseller', date: '2026-10-27', kind: 'discovery', notes })) as {
      call: PartnerBook['calls'][number]; topicsFound: boolean;
    };
    const sorted = sortNotes(notes);
    expect(answer.topicsFound).toBe(true);
    const call = (await bookOf(deps)).calls.find((c) => c.id === answer.call.id)!;
    expect(call).toMatchObject({ partnerId: f.partnerId, date: '2026-10-27', kind: 'discovery', topics: sorted.topics, notes: sorted.notes, updatedBy: 'Desk Agent for Anna' });
    expect(call.topics.revenueModel).toBe('Subscriptions, yearly.');
    expect(call.topics.customerPains).toBe('slow onboarding\nand long setups');
    expect(call.notes).toBe('## Next steps\nSend the deck.');
    expect(answer.call).toEqual(call);
  });

  it('a follow-up call keeps its notes as they are, with empty topics', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const notes = '## Revenue Model\nThey asked about prices.';
    const answer = value(await runTool(ctx, 'log_call', { accountId: f.accountId, partnerType: 'reseller', date: '2026-10-27', kind: 'follow_up', notes })) as {
      call: PartnerBook['calls'][number];
    };
    expect(answer.call).toMatchObject({ kind: 'follow_up', notes, topics: { revenueModel: '', customerPains: '' } });
  });

  it('log_call by a read agent is forbidden and writes nothing', async () => {
    const { deps, ctx } = await setup('read');
    const f = await withEverything(deps, anna, ANNA_CO);
    const before = await files(deps, f);
    const result = await runTool(ctx, 'log_call', { accountId: f.accountId, partnerType: 'reseller', date: '2026-10-27', kind: 'discovery', notes: 'x' });
    expect(result).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await files(deps, f)).toEqual(before);
    expect(deps.events.events).toEqual([]);
  });

  it('a partner type the account doesn\'t have, and Ben\'s account, are not_found like a missing account', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const bens = await withEverything(deps, ben, BEN_CO, 'Bens Partner');
    const call = (accountId: string, partnerType = 'reseller') => runTool(ctx, 'log_call', { accountId, partnerType, date: '2026-10-27', kind: 'follow_up', notes: 'x' });
    const missing = await call('ac_missing');
    expect(missing).toMatchObject({ ok: false, error: 'not_found' });
    expect(await call(f.accountId, 'referral')).toEqual(missing);
    expect(await call(bens.accountId)).toEqual(missing);
    expect((await bookOf(deps)).calls).toEqual([]);
    expect((await bookOf(deps, ben, BEN_CO)).calls).toEqual([]);
    expect(deps.events.events.filter((e) => e.command === 'partners.change')).toEqual([]);
  });
});

describe('update_partner', () => {
  const REFUSED: Array<[string, (f: Fixture, at: string | null) => Record<string, unknown>]> = [
    ['a stage', (f) => ({ accountId: f.accountId, stage: 'growth' })],
    ['a stage in the account', (f, at) => ({ accountId: f.accountId, account: { expectedUpdatedAt: at, stage: 'growth' } })],
    ['a step', (f, at) => ({ accountId: f.accountId, account: { expectedUpdatedAt: at, step: 'qualification' } })],
    ['a signedDate', (f) => ({ accountId: f.accountId, signedDate: '2026-10-01' })],
    ['a signedDate in the account', (f, at) => ({ accountId: f.accountId, account: { expectedUpdatedAt: at, signedDate: '2026-10-01' } })],
    ['a closing', (f, at) => ({ accountId: f.accountId, account: { expectedUpdatedAt: at, closed: 'no' } })],
    ['an exit', (f, at) => ({ accountId: f.accountId, account: { expectedUpdatedAt: at, exitedDate: '2026-10-01' } })],
    ['a 4C score', (f) => ({ accountId: f.accountId, desk: { credibility: 3 } })],
    ['a confirmed 4C score in the account', (f, at) => ({ accountId: f.accountId, account: { expectedUpdatedAt: at, confirmed: { commitment: 0 } } })],
    ['a 4C qualification', (f) => ({ accountId: f.accountId, qualification: { deskNotes: { credibility: 'x' } } })],
    ['a 4C score on a contact', (f) => ({ accountId: f.accountId, addContacts: [{ name: 'Tom', desk: { capability: 2 } }] })],
    ['a partner id on a contact', (f) => ({ accountId: f.accountId, updateContacts: [{ id: f.contactId, expectedUpdatedAt: null, accountId: 'ac_x' }] })],
    ['nothing to change', (f) => ({ accountId: f.accountId })],
    ['stage in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', stage: 'growth' }] })],
    ['step in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', step: 'qualification' }] })],
    ['signedDate in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', signedDate: '2026-10-01' }] })],
    ['closed in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', closed: 'no' }] })],
    ['closedReason in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', closedReason: 'x' }] })],
    ['exitedDate in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', exitedDate: '2026-10-01' }] })],
    ['exitReason in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', exitReason: 'x' }] })],
    ['desk in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', desk: { credibility: 3 } }] })],
    ['confirmed in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', confirmed: { commitment: 0 } }] })],
    ['source in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', source: 'ai_search' }] })],
    ['programId in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', programId: 'pg_other' }] })],
    ['level in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', level: 'preferred' }] })],
    ['mapFilled in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', mapFilled: true }] })],
    ['partnerId in a partner type\'s notes', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x', partnerId: 'pt_x' }] })],
    ['a partner type\'s notes with nothing to change', (f) => ({ accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: null }] })],
  ];

  it.each(REFUSED)('update_partner with %s is invalid and writes nothing', async (_what, input) => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const before = await files(deps, f);
    const result = await runTool(ctx, 'update_partner', input(f, before.book.accounts[0]!.updatedAt));
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
    expect(await files(deps, f)).toEqual(before);
    expect(deps.events.events).toEqual([]);
  });

  it('patches the account and adds and updates its contacts', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const book = await bookOf(deps);
    const contact = book.people.find((p) => p.id === f.contactId)!;
    const answer = value(await runTool(ctx, 'update_partner', {
      accountId: f.accountId,
      account: { expectedUpdatedAt: book.accounts[0]!.updatedAt, website: 'https://acme.example', country: 'Austria', targetCustomerType: 'smb', comments: 'Met at a fair' },
      addContacts: [{ name: 'Tom Berger', title: 'Head of sales', email: 'tom@acme.example', role: 'seller', activeSeller: true }],
      updateContacts: [{ id: f.contactId, expectedUpdatedAt: contact.updatedAt, title: 'Partner lead', role: 'sponsor' }],
    })) as { account: PartnerBook['accounts'][number]; people: PartnerBook['people'] };
    const now = await bookOf(deps);
    expect(now.accounts[0]).toMatchObject({ website: 'https://acme.example', country: 'Austria', targetCustomerType: 'smb', comments: 'Met at a fair', updatedBy: 'Desk Agent for Anna' });
    expect(now.people.find((p) => p.id === f.contactId)).toMatchObject({ name: 'Lena Ortiz', title: 'Partner lead', role: 'sponsor' });
    expect(now.people.find((p) => p.name === 'Tom Berger')).toMatchObject({ accountId: f.accountId, role: 'seller', activeSeller: true });
    expect(answer.account).toEqual(now.accounts[0]);
    expect(answer.people).toEqual(now.people.filter((p) => p.accountId === f.accountId));
  });

  it('a contact of another account is not_found, and nothing is written', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const other = (await partnerChange(deps, anna, ANNA_CO, { kind: 'add', entity: 'account', values: { company: 'Beta' } })).entityId!;
    deps.events.events.length = 0;
    const result = await runTool(ctx, 'update_partner', { accountId: other, addContacts: [{ name: 'Tom' }], updateContacts: [{ id: f.contactId, expectedUpdatedAt: null, title: 'x' }] });
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
    expect(deps.events.events).toEqual([]);
  });

  it('says which changes saved when one fails midway', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const book = await bookOf(deps);
    const result = await runTool(ctx, 'update_partner', {
      accountId: f.accountId,
      account: { expectedUpdatedAt: book.accounts[0]!.updatedAt, website: 'https://acme.example' },
      updateContacts: [{ id: f.contactId, expectedUpdatedAt: '2020-01-01T00:00:00.000Z', title: 'Partner lead' }],
    });
    expect(result).toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_SAVED_PART(1, 2, COPY.AGENT_CONFLICT) });
    const now = await bookOf(deps);
    expect(now.accounts[0]!.website).toBe('https://acme.example');
    expect(now.people.find((p) => p.id === f.contactId)!.title).toBe('');
  });
});

describe('update_partner: a partner type\'s notes', () => {
  it('saves why it fits and the source detail, stamped "Desk Agent for Anna"', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const partner = (await bookOf(deps)).partners.find((p) => p.id === f.partnerId)!;
    const answer = value(await runTool(ctx, 'update_partner', {
      accountId: f.accountId,
      partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: partner.updatedAt, whyItFits: 'Sells to banks', sourceDetail: 'Met at a fair' }],
    })) as { partners: PartnerBook['partners'] };
    const now = (await bookOf(deps)).partners.find((p) => p.id === f.partnerId)!;
    expect(now).toMatchObject({
      whyItFits: 'Sells to banks', sourceDetail: 'Met at a fair', updatedBy: 'Desk Agent for Anna',
      stage: partner.stage, signedDate: partner.signedDate, source: partner.source, desk: partner.desk, programId: partner.programId,
    });
    expect(answer.partners).toEqual([now]);
  });

  it('a stale expectedUpdatedAt is a conflict and writes nothing', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const before = await files(deps, f);
    const result = await runTool(ctx, 'update_partner', {
      accountId: f.accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: '2020-01-01T00:00:00.000Z', whyItFits: 'x' }],
    });
    expect(result).toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT });
    expect(await files(deps, f)).toEqual(before);
  });

  it('a partner type the account doesn\'t have is not_found, before anything is written', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const before = await files(deps, f);
    const book = before.book;
    const result = await runTool(ctx, 'update_partner', {
      accountId: f.accountId, account: { expectedUpdatedAt: book.accounts[0]!.updatedAt, website: 'x' },
      partnerTypes: [{ partnerType: 'referral', expectedUpdatedAt: null, whyItFits: 'x' }],
    });
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
    expect(await files(deps, f)).toEqual(before);
  });

  it('sends each partner type once', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const twice = { partnerType: 'reseller', expectedUpdatedAt: null, whyItFits: 'x' };
    expect(await runTool(ctx, 'update_partner', { accountId: f.accountId, partnerTypes: [twice, twice] })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('a command that throws midway', () => {
  it('update_partner says how many saved, with no word of the error, and logs ids only', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const book = await bookOf(deps);
    const lines = logged(deps);
    throwOnApply(deps.partnerBooks, 2);
    const result = await runTool(ctx, 'update_partner', {
      accountId: f.accountId,
      account: { expectedUpdatedAt: book.accounts[0]!.updatedAt, website: 'https://acme.example' },
      addContacts: [{ name: 'Tom Berger' }, { name: 'Ana Ruiz' }],
    });
    expect(result).toEqual({ ok: false, error: 'unavailable', message: COPY.AGENT_SAVED_PART(1, 3, COPY.AGENT_STEP_FAILED) });
    const now = await bookOf(deps);
    expect(now.accounts[0]!.website).toBe('https://acme.example');
    expect(now.people.map((p) => p.name)).toEqual(['Lena Ortiz']);
    expect(lines).toEqual([{ event: 'agent_step_failed', ids: { tool: 'update_partner', step: '2', of: '3' } }]);
    expect(JSON.stringify(lines)).not.toContain('SECRET');
  });

  it('prepare_review says how many saved when its second change throws', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    // The prep is written with applyMany; its changes one by one with apply.
    throwOnApply(deps.maps, 2);
    const result = await runTool(ctx, 'prepare_review', {
      mapId: f.mapId, blockers: [{ title: 'No demo account' }], commitments: [{ title: 'Joint webinar', side: 'joint' }],
    });
    expect(result).toEqual({ ok: false, error: 'unavailable', message: COPY.AGENT_SAVED_PART(1, 2, COPY.AGENT_STEP_FAILED) });
    const plan = await planOf(deps, f.mapId);
    expect(plan.reviewItems.filter((i) => i.kind === 'blocker').map((i) => i.title)).toEqual(['No demo account']);
    expect(plan.reviewItems.filter((i) => i.kind === 'commitment')).toEqual([]);
  });

  it('a throw before anything saved is thrown on, for the server to answer', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    throwOnApply(deps.partnerBooks, 1);
    await expect(runTool(ctx, 'update_partner', { accountId: f.accountId, addContacts: [{ name: 'Tom' }, { name: 'Ana' }] }))
      .rejects.toThrow('SECRET store failure');
    expect((await bookOf(deps)).people.map((p) => p.name)).toEqual(['Lena Ortiz']);
  });
});

describe('the MAP tools', () => {
  it('update_activity with an old expectedUpdatedAt is a conflict and writes nothing', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    // The agent reads the MAP.
    const read = value(await runTool(ctx, 'get_map', { mapId: f.mapId })) as { value: MapPlan };
    const seen = read.value.activities.find((a) => a.id === f.activityId)!;
    // Then Anna changes the activity, a little later.
    deps.clock = () => LATER;
    await mapChange(deps, anna, f.mapId, { kind: 'update', entity: 'activity', id: f.activityId, patch: { status: 'blocked' } });
    const before = await files(deps, f);
    deps.events.events.length = 0;
    const result = await runTool(ctx, 'update_activity', {
      mapId: f.mapId, activityId: f.activityId, expectedUpdatedAt: seen.updatedAt, status: 'done', note: 'SECRET agent note',
    });
    expect(result).toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT });
    expect(await files(deps, f)).toEqual(before);
    expect(before.plan.activities.find((a) => a.id === f.activityId)).toMatchObject({ status: 'blocked', note: '', updatedBy: 'Anna' });
    expect(deps.events.events).toEqual([]);
  });

  it('update_activity needs the expectedUpdatedAt it read', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const result = await runTool(ctx, 'update_activity', { mapId: f.mapId, activityId: f.activityId, status: 'done' });
    expect(result).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { expectedUpdatedAt: expect.any(String) } });
  });

  it('add_activity adds one and answers it; update_activity and update_milestone change only what they name', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const added = value(await runTool(ctx, 'add_activity', {
      mapId: f.mapId, title: 'Kickoff call', side: 'joint', ownerId: f.personId, dueDate: '2026-11-05', milestoneId: f.milestoneId,
    })) as { activity: MapPlan['activities'][number] };
    expect(added.activity).toMatchObject({ title: 'Kickoff call', side: 'joint', ownerId: f.personId, status: 'not_started', updatedBy: 'Desk Agent for Anna' });
    const updated = value(await runTool(ctx, 'update_activity', {
      mapId: f.mapId, activityId: added.activity.id, expectedUpdatedAt: added.activity.updatedAt, status: 'done', note: 'Went well',
    })) as { activity: MapPlan['activities'][number] };
    expect(updated.activity).toMatchObject({ id: added.activity.id, title: 'Kickoff call', status: 'done', note: 'Went well', completedDate: '2026-10-28' });
    const milestone = value(await runTool(ctx, 'update_milestone', { mapId: f.mapId, milestoneId: f.milestoneId, achievedDate: '2026-10-20' })) as {
      milestone: MapPlan['milestones'][number];
    };
    expect(milestone.milestone).toMatchObject({ id: f.milestoneId, name: 'First deal', achievedDate: '2026-10-20' });
    const plan = await planOf(deps, f.mapId);
    expect(plan.activities.find((a) => a.id === added.activity.id)).toEqual(updated.activity);
    expect(plan.milestones.find((m) => m.id === f.milestoneId)).toEqual(milestone.milestone);
  });

  it('update_activity and update_milestone refuse what the spec leaves to people or other screens', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const refused: Array<[string, Record<string, unknown>]> = [
      ['update_activity', { mapId: f.mapId, activityId: f.activityId, expectedUpdatedAt: null, side: 'us' }],
      ['update_activity', { mapId: f.mapId, activityId: f.activityId, expectedUpdatedAt: null }],
      ['update_milestone', { mapId: f.mapId, milestoneId: f.milestoneId, name: 'Renamed' }],
      ['update_milestone', { mapId: f.mapId, milestoneId: f.milestoneId }],
      ['add_activity', { mapId: f.mapId, title: 'x', updatedBy: 'Someone' }],
    ];
    for (const [name, input] of refused) expect({ name, input, result: await runTool(ctx, name, input) }).toMatchObject({ result: { ok: false, error: 'invalid' } });
    expect(deps.events.events).toEqual([]);
  });

  it('Ben\'s MAP is file_not_found like a missing one, and nothing is written', async () => {
    const { deps, ctx } = await setup();
    await withEverything(deps, anna, ANNA_CO);
    const bens = await withEverything(deps, ben, BEN_CO, 'Bens Partner');
    const before = await planOf(deps, bens.mapId, ben);
    deps.events.events.length = 0;
    const pairs: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['add_activity', { mapId: bens.mapId, title: 'x' }, { mapId: 'mp_missing', title: 'x' }],
      ['update_activity', { mapId: bens.mapId, activityId: bens.activityId, expectedUpdatedAt: null, status: 'done' }, { mapId: 'mp_missing', activityId: bens.activityId, expectedUpdatedAt: null, status: 'done' }],
      ['update_milestone', { mapId: bens.mapId, milestoneId: bens.milestoneId, targetDate: null }, { mapId: 'mp_missing', milestoneId: bens.milestoneId, targetDate: null }],
      ['prepare_review', { mapId: bens.mapId }, { mapId: 'mp_missing' }],
    ];
    for (const [name, theirs, missing] of pairs) {
      const answer = await runTool(ctx, name, theirs);
      expect({ name, answer }).toMatchObject({ name, answer: { ok: false, error: 'file_not_found' } });
      expect({ name, answer }).toEqual({ name, answer: await runTool(ctx, name, missing) });
    }
    expect(deps.events.events).toEqual([]);
    expect(await planOf(deps, bens.mapId, ben)).toEqual(before);
  });
});

describe('prepare_review', () => {
  type ReviewAnswer = { review: { id: string }; items: Array<{ kind: string; title: string; note: string; refId: string | null }>; numbers: Array<{ key: string; actual: number | null }> };

  it('prepare_review opens the prep once and adds a commitment; a second call adds no second review', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const first = value(await runTool(ctx, 'prepare_review', { mapId: f.mapId, commitments: [{ title: 'Joint webinar', side: 'joint' }] })) as ReviewAnswer;
    expect(first.items.filter((i) => i.kind === 'commitment').map((i) => i.title)).toEqual(['Joint webinar']);
    const second = value(await runTool(ctx, 'prepare_review', { mapId: f.mapId, commitments: [{ title: 'Train five sellers', side: 'partner' }] })) as ReviewAnswer;
    expect(second.review.id).toBe(first.review.id);
    const plan = await planOf(deps, f.mapId);
    expect(plan.reviews).toHaveLength(1);
    expect(plan.reviewItems.filter((i) => i.kind === 'commitment').map((i) => i.title)).toEqual(['Joint webinar', 'Train five sellers']);
    expect(deps.events.events.filter((e) => e.command === 'reviews.open')).toHaveLength(1);
  });

  it('fills a reason for work not done, the numbers, and a blocker', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const answer = value(await runTool(ctx, 'prepare_review', {
      mapId: f.mapId,
      reasons: [{ activityId: f.activityId, reason: 'Their lead left' }],
      numbers: [{ key: 'dealsWon', actual: 3, note: 'Two in Vienna' }, { key: 'recommend', actual: 8 }],
      blockers: [{ title: 'No demo account' }],
    })) as ReviewAnswer;
    const reason = answer.items.filter((i) => i.kind === 'notDone');
    expect(reason).toEqual([expect.objectContaining({ refId: f.activityId, note: 'Their lead left' })]);
    expect(answer.items.filter((i) => i.kind === 'blocker').map((i) => i.title)).toEqual(['No demo account']);
    expect(answer.numbers.map((n) => [n.key, n.actual])).toEqual([['dealsWon', 3], ['recommend', 8]]);
    // A second call updates the reason and the number in place.
    const again = value(await runTool(ctx, 'prepare_review', {
      mapId: f.mapId, reasons: [{ activityId: f.activityId, reason: 'Their lead is back' }], numbers: [{ key: 'dealsWon', actual: 4 }],
    })) as ReviewAnswer;
    expect(again.items.filter((i) => i.kind === 'notDone').map((i) => i.note)).toEqual(['Their lead is back']);
    expect(again.numbers.filter((n) => n.key === 'dealsWon').map((n) => n.actual)).toEqual([4]);
  });

  it('a reason for an activity not in the review is not_found, and nothing is written', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    await runTool(ctx, 'prepare_review', { mapId: f.mapId });
    const before = await planOf(deps, f.mapId);
    deps.events.events.length = 0;
    const result = await runTool(ctx, 'prepare_review', {
      mapId: f.mapId, blockers: [{ title: 'x' }], reasons: [{ activityId: 'ac_nothere', reason: 'x' }],
    });
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
    expect(deps.events.events).toEqual([]);
    expect(await planOf(deps, f.mapId)).toEqual(before);
  });

  it('says which changes saved when one fails midway', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const result = await runTool(ctx, 'prepare_review', {
      mapId: f.mapId, numbers: [{ key: 'dealsWon', actual: 3 }, { key: 'recommend', actual: 11 }], blockers: [{ title: 'Never written' }],
    });
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
    if (result.ok) return;
    expect(result.message).toMatch(/^Saved 1 of 3 changes/);
    const plan = await planOf(deps, f.mapId);
    expect(plan.reviewNumbers.map((n) => [n.key, n.actual])).toEqual([['dealsWon', 3]]);
    expect(plan.reviewItems.filter((i) => i.kind === 'blocker')).toEqual([]);
  });

  it('before signing there is no review to prepare', async () => {
    const { deps, ctx } = await setup();
    const accountId = (await partnerChange(deps, anna, ANNA_CO, { kind: 'add', entity: 'account', values: { company: 'Acme' } })).entityId!;
    const partnerId = (await partnerChange(deps, anna, ANNA_CO, { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } })).entityId!;
    const { mapId } = value(await startMap(deps, anna, { companyId: ANNA_CO, partnerId }));
    expect(await runTool(ctx, 'prepare_review', { mapId, commitments: [{ title: 'x', side: 'us' }] })).toMatchObject({ ok: false, error: 'invalid' });
    expect((await planOf(deps, mapId)).reviews).toEqual([]);
  });
});

describe('update_market', () => {
  it('update_market with a hypothesis status or market status is invalid', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const before = await files(deps, f);
    const at = before.market.info.updatedAt;
    const hypothesis = before.market.hypotheses[0]!;
    const refused = [
      { marketId: f.marketId, status: 'validated' },
      { marketId: f.marketId, market: { expectedUpdatedAt: at, status: 'invalidated' } },
      { marketId: f.marketId, market: { expectedUpdatedAt: at, statusNote: 'SECRET' } },
      { marketId: f.marketId, hypothesis: { id: hypothesis.id, expectedUpdatedAt: hypothesis.updatedAt, status: 'holds' } },
      { marketId: f.marketId, hypothesis: { id: hypothesis.id, expectedUpdatedAt: hypothesis.updatedAt, status: 'dropped', name: 'x' } },
      { marketId: f.marketId, market: { expectedUpdatedAt: at, partnerType: 'referral' } },
      { marketId: f.marketId },
    ];
    for (const input of refused) expect({ input, result: await runTool(ctx, 'update_market', input) }).toMatchObject({ input, result: { ok: false, error: 'invalid' } });
    expect(await files(deps, f)).toEqual(before);
    expect(deps.events.events).toEqual([]);
  });

  it('changes the market\'s texts and a hypothesis\'s text', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const market = value(await readMarket(deps, anna, { marketId: f.marketId })).value;
    const hypothesis = market.hypotheses[0]!;
    const answer = value(await runTool(ctx, 'update_market', {
      marketId: f.marketId,
      market: { expectedUpdatedAt: market.info.updatedAt, statement: 'Agencies sell our tool to banks', mustHaves: ['A sales team'] },
      hypothesis: { id: hypothesis.id, expectedUpdatedAt: hypothesis.updatedAt, theirSide: 'More projects', ourSide: 'Reach' },
    })) as { info: { statement: string }; hypothesis: { theirSide: string } };
    const now = value(await readMarket(deps, anna, { marketId: f.marketId })).value;
    expect(now.info).toMatchObject({ statement: 'Agencies sell our tool to banks', mustHaves: ['A sales team'], status: market.info.status });
    expect(now.hypotheses[0]).toMatchObject({ theirSide: 'More projects', ourSide: 'Reach', status: hypothesis.status, updatedBy: 'Desk Agent for Anna' });
    expect(answer.info).toEqual(now.info);
    expect(answer.hypothesis).toEqual(now.hypotheses[0]);
  });
});

describe('update_case and save_company_facts', () => {
  it('update_case changes only the fields it names, against the case it read', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const before = value(await readCase(deps, anna, { caseId: f.caseId })).value;
    const answer = value(await runTool(ctx, 'update_case', {
      caseId: f.caseId, expectedUpdatedAt: before.updatedAt, case: { title: 'Agent case', deals: [1, 2, 3, 4, 5], scenario: 'careful' },
    })) as { value: typeof before };
    const now = value(await readCase(deps, anna, { caseId: f.caseId })).value;
    expect(now).toMatchObject({ title: 'Agent case', deals: [1, 2, 3, 4, 5], scenario: 'careful', offer: before.offer, ours: before.ours });
    expect(answer.value).toEqual(now);
  });

  it('update_case with an old expectedUpdatedAt is a conflict; sharing or the partner can\'t be sent', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const before = await files(deps, f);
    expect(await runTool(ctx, 'update_case', { caseId: f.caseId, expectedUpdatedAt: '2020-01-01T00:00:00.000Z', case: { title: 'x' } }))
      .toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT });
    for (const c of [{ shared: { sharedAt: '2026-10-28T10:00:00.000Z' } }, { partnerId: 'pt_other' }, { typeId: 'x' }, {}]) {
      expect(await runTool(ctx, 'update_case', { caseId: f.caseId, expectedUpdatedAt: before.case.updatedAt, case: c })).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(await files(deps, f)).toEqual(before);
  });

  it('save_company_facts changes only the facts it names', async () => {
    const { deps, ctx } = await setup();
    const before = value(await readCompanyFacts(deps, anna, { companyId: ANNA_CO })).value;
    value(await runTool(ctx, 'save_company_facts', { expectedUpdatedAt: before.updatedAt, facts: { yearly: 12000, renew: 80 } }));
    const now = value(await readCompanyFacts(deps, anna, { companyId: ANNA_CO })).value;
    expect(now).toMatchObject({ ...before, yearly: 12000, renew: 80, updatedAt: expect.any(String) });
    expect(await runTool(ctx, 'save_company_facts', { expectedUpdatedAt: before.updatedAt, facts: { yearly: 1 } }))
      .toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT });
    expect(await runTool(ctx, 'save_company_facts', { expectedUpdatedAt: now.updatedAt, facts: { id: 'cf_other' } })).toMatchObject({ ok: false, error: 'invalid' });
  });
});
