import { FOUR_C } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Actor, AgentLevel } from '../actor';
import { changeMarket, createMarket } from '../markets';
import { changePartner, readPartners } from '../partners';
import { rejectProposal } from '../proposals';
import { FORBIDDEN } from '../result';
import { makeTestDeps } from '../testing';
import { agentContext } from './context';
import type { PartnerAccountRead } from './read-tools';
import { AGENT_TOOLS, findTool, runTool } from './tools';

const CO = 'co_aaaaaaaaaa';
const ruth: Actor = { kind: 'owner', userId: 'u_bern', displayName: 'Ruth' };
const SPEC_4C = 'Proposes desk check 4C scores for one partner type, each letter with a score from 0 to 3 and its evidence, for example '
  + 'from a web search or from a call\'s notes. The person accepts or rejects each letter in PartnerStandard Desk. The confirmed check is the '
  + 'person\'s own; this tool never changes it.';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

/** Ruth's Partners file with Acme (a reseller in Recruitment) and a market with one hypothesis; their agent at `level`. */
async function setup(level: AgentLevel = 'propose') {
  const deps = makeTestDeps({ companies: { u_bern: CO } });
  await readPartners(deps, ruth, { companyId: CO });
  deps.proposals.allowApp('u_bern', 'c_claude', 'Claude');
  const change = async (c: Record<string, unknown>) => value(await changePartner(deps, ruth, { companyId: CO, change: c })).entityId!;
  const accountId = await change({ kind: 'add', entity: 'account', values: { company: 'Acme' } });
  const partnerId = await change({ kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } });
  const { marketId } = value(await createMarket(deps, ruth, {
    companyId: CO, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
  }));
  const hypothesisId = value(await changeMarket(deps, ruth, {
    marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'Banks' } },
  })).entityId!;
  const ctx = await agentContext(deps, { userId: 'u_bern', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
  deps.events.events.length = 0;
  return { deps, ctx, accountId, partnerId, marketId, hypothesisId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** The partner type's and the market's updatedAt as an agent reads them, with the read tools. */
async function readAts(s: Setup) {
  const account = value(await runTool(s.ctx, 'get_partner', { accountId: s.accountId })) as PartnerAccountRead;
  const market = value(await runTool(s.ctx, 'get_market', { marketId: s.marketId })) as {
    value: { info: { updatedAt: string | null }; hypotheses: Array<{ id: string; updatedAt: string | null }> };
  };
  return {
    partner: account.partners[0]!.updatedAt,
    market: market.value.info.updatedAt,
    hypothesis: market.value.hypotheses.find((h) => h.id === s.hypothesisId)!.updatedAt,
  };
}

/** Each propose tool with an input it accepts. */
async function proposals(s: Setup): Promise<Record<string, Record<string, unknown>>> {
  const at = await readAts(s);
  return {
    propose_4c_scores: { partnerId: s.partnerId, expectedUpdatedAt: at.partner, letters: { customerBase: { score: 3, evidence: 'Serves 400 banks.' } } },
    propose_stage: { partnerId: s.partnerId, expectedUpdatedAt: at.partner, to: 'discovery_call', reason: 'They answered our email.' },
    propose_close: { partnerId: s.partnerId, expectedUpdatedAt: at.partner, as: 'not_now', reason: 'No budget this year.' },
    propose_signed: { partnerId: s.partnerId, expectedUpdatedAt: at.partner, signedDate: '2026-10-27', reason: 'Signed yesterday.' },
    propose_partners: { marketId: s.marketId, companies: [{ company: 'Acme' }, { company: 'Globex', website: 'globex.example' }], reason: 'A web search.' },
    propose_hypothesis_status: { marketId: s.marketId, hypothesisId: s.hypothesisId, expectedUpdatedAt: at.hypothesis, to: 'holds', reason: 'Three calls agree.' },
    propose_market_status: { marketId: s.marketId, expectedUpdatedAt: at.market, to: 'validated', note: 'Two partners signed.', reason: 'Both signed.' },
  };
}

const PROPOSE_TOOLS = [
  'propose_4c_scores', 'propose_stage', 'propose_close', 'propose_signed', 'propose_partners', 'propose_hypothesis_status',
  'propose_market_status', 'withdraw_proposal',
];

describe('the propose tools', () => {
  it('are the seven of spec 6.1 and withdraw_proposal, at level propose, with the plan’s routes', () => {
    expect(AGENT_TOOLS.filter((t) => t.level === 'propose').map((t) => `${t.name} ${t.rest.method} ${t.rest.path}`)).toEqual([
      'propose_4c_scores POST /proposals/4c-scores',
      'propose_stage POST /proposals/stage',
      'propose_close POST /proposals/close',
      'propose_signed POST /proposals/signed',
      'propose_partners POST /proposals/partners',
      'propose_hypothesis_status POST /proposals/hypothesis-status',
      'propose_market_status POST /proposals/market-status',
      'withdraw_proposal POST /proposals/{proposalId}/withdraw',
    ]);
    expect(findTool('list_proposals')).toMatchObject({ level: 'read', rest: { method: 'GET', path: '/proposals' } });
  });

  it('each input is strict, names a reason where the plan does, and the target’s expectedUpdatedAt', () => {
    const fields = (name: string) => {
      const schema = z.toJSONSchema(findTool(name)!.input, { io: 'input' }) as { properties: Record<string, unknown>; required?: string[]; additionalProperties: unknown };
      expect(schema.additionalProperties, name).toBe(false);
      return { all: Object.keys(schema.properties).sort(), required: [...(schema.required ?? [])].sort() };
    };
    expect(fields('propose_4c_scores')).toEqual({ all: ['expectedUpdatedAt', 'letters', 'partnerId'], required: ['expectedUpdatedAt', 'letters', 'partnerId'] });
    expect(fields('propose_stage').all).toEqual(['expectedUpdatedAt', 'partnerId', 'reason', 'to']);
    expect(fields('propose_close').all).toEqual(['as', 'expectedUpdatedAt', 'partnerId', 'reason']);
    expect(fields('propose_signed').all).toEqual(['expectedUpdatedAt', 'partnerId', 'reason', 'signedDate']);
    expect(fields('propose_partners')).toEqual({ all: ['companies', 'hypothesisId', 'marketId', 'reason'], required: ['companies', 'marketId', 'reason'] });
    expect(fields('propose_hypothesis_status').all).toEqual(['expectedUpdatedAt', 'hypothesisId', 'marketId', 'reason', 'to']);
    expect(fields('propose_market_status').all).toEqual(['expectedUpdatedAt', 'marketId', 'note', 'reason', 'to']);
    expect(fields('withdraw_proposal').all).toEqual(['proposalId']);
    expect(fields('list_proposals')).toEqual({ all: ['cursor', 'limit', 'proposalId', 'status'], required: [] });
    for (const name of ['propose_stage', 'propose_close', 'propose_signed', 'propose_hypothesis_status', 'propose_market_status']) {
      expect(fields(name).required, name).toEqual(fields(name).all);
    }
  });

  it('propose_4c_scores has no confirmed letter in its schema, and its description is the spec’s', async () => {
    const tool = findTool('propose_4c_scores')!;
    expect(tool.description).toBe(SPEC_4C);
    const schema = z.toJSONSchema(tool.input, { io: 'input' }) as unknown as { properties: { letters: { properties: Record<string, { properties: object }> } } };
    expect(JSON.stringify(schema)).not.toMatch(/confirmed/i);
    expect(Object.keys(schema.properties.letters.properties)).toEqual([...FOUR_C]);
    for (const c of FOUR_C) expect(Object.keys(schema.properties.letters.properties[c]!.properties).sort()).toEqual(['evidence', 'score']);

    const s = await setup();
    const at = await readAts(s);
    const letter = { score: 2, evidence: 'Known brand.' };
    for (const bad of [
      { partnerId: s.partnerId, expectedUpdatedAt: at.partner, letters: { credibility: letter }, confirmed: { credibility: letter } },
      { partnerId: s.partnerId, expectedUpdatedAt: at.partner, letters: { credibility: letter, confirmed: letter } },
      { partnerId: s.partnerId, expectedUpdatedAt: at.partner, letters: { credibility: { ...letter, check: 'confirmed' } } },
    ]) {
      expect(await runTool(s.ctx, 'propose_4c_scores', bad)).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(s.deps.proposals.rows).toEqual([]);
  });

  it('propose_4c_scores with no letter names the letters field: "Propose at least one letter."', async () => {
    const s = await setup();
    const at = await readAts(s);
    const result = await runTool(s.ctx, 'propose_4c_scores', { partnerId: s.partnerId, expectedUpdatedAt: at.partner, letters: {} });
    expect(result).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { letters: COPY.PROPOSAL_NO_LETTER } });
  });

  it('each propose tool makes a waiting proposal, answers its id, status and the line for the person, and changes nothing else', async () => {
    const s = await setup();
    const inputs = await proposals(s);
    const before = value(await readPartners(s.deps, ruth, { companyId: CO })).value;
    for (const [name, input] of Object.entries(inputs)) {
      const answer = value(await runTool(s.ctx, name, input)) as Record<string, unknown>;
      expect({ name, keys: Object.keys(answer).sort() }).toEqual({
        name, keys: name === 'propose_partners' ? ['alreadyPartners', 'message', 'proposalId', 'status'] : ['message', 'proposalId', 'status'],
      });
      expect(answer).toMatchObject({ proposalId: expect.stringMatching(/^prp_/), status: 'waiting', message: 'Proposed. It waits for Ruth in PartnerStandard Desk.' });
    }
    // Acme is a reseller already; Globex is new.
    expect(s.deps.proposals.rows.map((r) => [r.kind, r.status])).toEqual([
      ['fourC', 'waiting'], ['stage', 'waiting'], ['close', 'waiting'], ['signed', 'waiting'], ['partners', 'waiting'],
      ['hypothesisStatus', 'waiting'], ['marketStatus', 'waiting'],
    ]);
    const after = value(await readPartners(s.deps, ruth, { companyId: CO })).value;
    expect(after.partners).toEqual(before.partners);
    expect(after.accounts).toEqual(before.accounts);
  });

  it('propose_partners answers which companies are partners already, by index; no hypothesis is null', async () => {
    const s = await setup();
    const answer = value(await runTool(s.ctx, 'propose_partners', (await proposals(s)).propose_partners)) as { alreadyPartners: number[] };
    expect(answer.alreadyPartners).toEqual([0]);
    expect(s.deps.proposals.rows[0]).toMatchObject({ kind: 'partners', marketId: s.marketId, hypothesisId: null });
  });

  it('propose_partners takes a hypothesisId of null as none', async () => {
    const s = await setup();
    value(await runTool(s.ctx, 'propose_partners', { ...(await proposals(s)).propose_partners, hypothesisId: null }));
    expect(s.deps.proposals.rows[0]).toMatchObject({ kind: 'partners', marketId: s.marketId, hypothesisId: null });
  });

  it('the 4C tool asks for every letter in one proposal', () => {
    const schema = z.toJSONSchema(findTool('propose_4c_scores')!.input, { io: 'input' }) as unknown as { properties: { letters: { description: string } } };
    expect(schema.properties.letters.description).toMatch(/Send every letter in one proposal\.$/);
  });

  it('propose_stage to exit answers invalid with "Only a person moves a partner into Exit."', async () => {
    const s = await setup();
    const at = await readAts(s);
    expect(await runTool(s.ctx, 'propose_stage', { partnerId: s.partnerId, expectedUpdatedAt: at.partner, to: 'exit', reason: 'Done.' }))
      .toEqual({ ok: false, error: 'invalid', message: COPY.PROPOSAL_NO_EXIT });
    expect(s.deps.proposals.rows).toEqual([]);
  });

  it('an old expectedUpdatedAt is a conflict that says to read again', async () => {
    const s = await setup();
    expect(await runTool(s.ctx, 'propose_close', { partnerId: s.partnerId, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', as: 'no', reason: 'x' }))
      .toEqual({ ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT });
  });

  it('a change-level agent’s propose call is forbidden, and nothing is written', async () => {
    for (const level of ['read', 'change'] as const) {
      const s = await setup(level);
      const inputs = await proposals(s);
      for (const name of PROPOSE_TOOLS) {
        const input = name === 'withdraw_proposal' ? { proposalId: 'prp_aaaaaaaaaa' } : inputs[name];
        expect({ level, name, result: await runTool(s.ctx, name, input) }).toEqual({ level, name, result: FORBIDDEN });
      }
      expect(s.deps.proposals.rows).toEqual([]);
      expect(s.deps.events.events).toEqual([]);
    }
  });

  it('withdraw_proposal withdraws its own waiting proposal; again answers the same', async () => {
    const s = await setup();
    const { proposalId } = value(await runTool(s.ctx, 'propose_stage', (await proposals(s)).propose_stage)) as { proposalId: string };
    expect(value(await runTool(s.ctx, 'withdraw_proposal', { proposalId }))).toEqual({ proposalId, status: 'withdrawn' });
    expect(value(await runTool(s.ctx, 'withdraw_proposal', { proposalId }))).toEqual({ proposalId, status: 'withdrawn' });
    expect(await runTool(s.ctx, 'withdraw_proposal', { proposalId: 'prp_zzzzzzzzzz' })).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('list_proposals', () => {
  type Listed = { items: Array<Record<string, unknown>>; nextCursor: string | null };

  it('list_proposals after a reject shows the person’s note', async () => {
    const s = await setup();
    const inputs = await proposals(s);
    const stage = value(await runTool(s.ctx, 'propose_stage', inputs.propose_stage)) as { proposalId: string };
    const fourC = value(await runTool(s.ctx, 'propose_4c_scores', inputs.propose_4c_scores)) as { proposalId: string };
    value(await rejectProposal(s.deps, ruth, { companyId: CO, proposalId: stage.proposalId, note: 'Not before the budget call.' }));

    const listed = value(await runTool(s.ctx, 'list_proposals', {})) as Listed;
    expect(listed.nextCursor).toBeNull();
    expect(listed.items).toEqual(expect.arrayContaining([
      {
        proposalId: stage.proposalId, kind: 'stage', status: 'rejected', accountId: s.accountId, partnerId: s.partnerId, marketId: null,
        hypothesisId: null, createdAt: expect.any(String), answeredAt: expect.any(String), expiresAt: expect.any(String),
        answerNote: 'Not before the budget call.',
      },
      expect.objectContaining({ proposalId: fourC.proposalId, kind: 'fourC', status: 'waiting', answeredAt: null, answerNote: null }),
    ]));
    // Nothing of our database's own is in it: no person, client id or file.
    expect(JSON.stringify(listed)).not.toMatch(/u_bern|c_claude|fileId|userId|madeBy/);

    // One by id, and by status.
    const one = value(await runTool(s.ctx, 'list_proposals', { proposalId: stage.proposalId })) as Listed;
    expect(one.items.map((i) => i.answerNote)).toEqual(['Not before the budget call.']);
    const waiting = value(await runTool(s.ctx, 'list_proposals', { status: 'waiting' })) as Listed;
    expect(waiting.items.map((i) => i.proposalId)).toEqual([fourC.proposalId]);
    expect(await runTool(s.ctx, 'list_proposals', { proposalId: 'prp_zzzzzzzzzz' })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('reads the Partners file only when an answered proposal is in the page, and pages as the other lists', async () => {
    const s = await setup();
    const inputs = await proposals(s);
    const made: string[] = [];
    for (const name of ['propose_stage', 'propose_close', 'propose_signed']) {
      made.push((value(await runTool(s.ctx, name, inputs[name])) as { proposalId: string }).proposalId);
    }
    const read = vi.spyOn(s.deps.partnerBooks, 'read');
    const first = value(await runTool(s.ctx, 'list_proposals', { limit: 2 })) as Listed;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = value(await runTool(s.ctx, 'list_proposals', { limit: 2, cursor: first.nextCursor })) as Listed;
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map((i) => i.proposalId).sort()).toEqual([...made].sort());
    expect(read).not.toHaveBeenCalled();

    value(await rejectProposal(s.deps, ruth, { companyId: CO, proposalId: made[0]! }));
    read.mockClear();
    const all = value(await runTool(s.ctx, 'list_proposals', {})) as Listed;
    expect(read).toHaveBeenCalledTimes(1);
    // Rejected without a note: no note to show.
    expect(all.items.find((i) => i.proposalId === made[0])).toMatchObject({ status: 'rejected', answerNote: null });
  });

  it('a read-level agent sees an empty list; another agent of the person sees none of Claude’s', async () => {
    const s = await setup();
    value(await runTool(s.ctx, 'propose_stage', (await proposals(s)).propose_stage));
    const reader = await agentContext(s.deps, { userId: 'u_bern', displayName: 'Ruth', agentName: 'n8n', level: 'read', via: { kind: 'key', keyId: 'k_n8n' } });
    expect(value(await runTool(reader, 'list_proposals', {}))).toEqual({ items: [], nextCursor: null });
  });
});

describe('this_week', () => {
  it('this_week answers proposalsWaiting, all agents together', async () => {
    const s = await setup();
    expect(value(await runTool(s.ctx, 'this_week', {}))).toMatchObject({ proposalsWaiting: 0 });
    const inputs = await proposals(s);
    value(await runTool(s.ctx, 'propose_stage', inputs.propose_stage));
    s.deps.proposals.addKey('u_bern', 'k_n8n', 'n8n');
    const key = await agentContext(s.deps, { userId: 'u_bern', displayName: 'Ruth', agentName: 'n8n', level: 'propose', via: { kind: 'key', keyId: 'k_n8n' } });
    value(await runTool(key, 'propose_close', inputs.propose_close));
    // A read-level agent sees the count too: it is the person's, not the agent's.
    const reader = await agentContext(s.deps, { userId: 'u_bern', displayName: 'Ruth', agentName: 'n8n', level: 'read', via: { kind: 'key', keyId: 'k_n8n' } });
    expect(value(await runTool(reader, 'this_week', {}))).toMatchObject({ proposalsWaiting: 2 });
  });
});
