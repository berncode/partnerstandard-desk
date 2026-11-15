import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import {
  AGENT_TOOLS, agentContext, changeMarket, changePartner, createMarket, readMarket, readPartners, toolsFor, type Actor, type AgentLevel,
} from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { AGENT_INSTRUCTIONS, AGENT_PROMPTS, AGENT_RESOURCES } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import packageJson from '../../package.json';
import { buildMcpServer } from './mcp-server';

/** The tools spec 5.3 keeps out until the proposals design (plan, Global Constraints). */
const DECISION_TOOLS = ['add_partners', 'score_4c', 'move_stage', 'close_partner', 'mark_signed', 'record_review'];
/** What the proposals design adds (agent proposals spec 6): seven propose tools, list_proposals and withdraw_proposal. */
const PROPOSAL_TOOLS = [
  'list_proposals', 'propose_4c_scores', 'propose_stage', 'propose_close', 'propose_signed', 'propose_partners', 'propose_hypothesis_status',
  'propose_market_status', 'withdraw_proposal',
];
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const CO = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

const open: Client[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

/** A client connected in memory to the server one agent request gets, at the level its grant or key has. */
async function connect(level: AgentLevel) {
  const deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
  const ctx = await agentContext(deps, { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(ctx).connect(serverSide);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientSide);
  open.push(client);
  return { client, deps };
}

/** Anna's Partners file with Acme, a reseller in Recruitment, and a market with one partner hypothesis. */
async function withPartner(deps: ReturnType<typeof makeTestDeps>) {
  await readPartners(deps, anna, { companyId: CO });
  const change = async (c: Record<string, unknown>) => value(await changePartner(deps, anna, { companyId: CO, change: c })).entityId!;
  const accountId = await change({ kind: 'add', entity: 'account', values: { company: 'Acme' } });
  const partnerId = await change({ kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } });
  const partnerUpdatedAt = value(await readPartners(deps, anna, { companyId: CO })).value.partners.find((p) => p.id === partnerId)!.updatedAt;
  const { marketId } = value(await createMarket(deps, anna, {
    companyId: CO, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
  }));
  const hypothesisId = value(await changeMarket(deps, anna, { marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'Banks' } } })).entityId!;
  return { accountId, partnerId, partnerUpdatedAt, marketId, hypothesisId };
}

const textOf = (result: { content?: unknown[] }): string =>
  (result.content ?? []).map((c) => (c as { text?: string }).text ?? '').join('\n');

describe('the MCP server', () => {
  it('names itself partner-desk with the app’s version, and gives the instructions', async () => {
    const { client } = await connect('read');
    expect(client.getServerVersion()).toMatchObject({ name: 'partner-desk', version: packageJson.version });
    expect(client.getInstructions()).toBe(AGENT_INSTRUCTIONS);
  });

  it('a read grant lists only read and calc tools', async () => {
    const { client } = await connect('read');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(toolsFor('read').map((t) => t.name));
    expect(AGENT_TOOLS.filter((t) => t.level === 'change').some((t) => tools.some((l) => l.name === t.name))).toBe(false);
    expect(tools.some((t) => AGENT_TOOLS.find((a) => a.name === t.name)?.level === 'calc')).toBe(true);
  });

  it('a change grant lists change tools too', async () => {
    const { client } = await connect('change');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(toolsFor('change').map((t) => t.name));
    expect(tools.map((t) => t.name)).toContain('log_call');
  });

  it('tools/list at propose lists the nine new tools; at change it lists none of the propose tools', async () => {
    const proposer = (await (await connect('propose')).client.listTools()).tools.map((t) => t.name);
    expect(proposer).toEqual(AGENT_TOOLS.map((t) => t.name));
    expect(proposer).toEqual(expect.arrayContaining([...PROPOSAL_TOOLS, 'log_call', 'get_partner', 'calculate_case']));
    const changer = (await (await connect('change')).client.listTools()).tools.map((t) => t.name);
    const proposeLevel = AGENT_TOOLS.filter((t) => t.level === 'propose').map((t) => t.name);
    expect(proposeLevel).toEqual(PROPOSAL_TOOLS.filter((n) => n !== 'list_proposals'));
    for (const name of proposeLevel) expect(changer).not.toContain(name);
    // list_proposals is a read: every level has it, and a change agent's list is empty.
    expect(changer).toContain('list_proposals');
    expect((await (await connect('read')).client.listTools()).tools.map((t) => t.name)).toContain('list_proposals');
  });

  it('no listed tool is a decision tool', async () => {
    const { client } = await connect('change');
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const decision of DECISION_TOOLS) expect(names).not.toContain(decision);
  });

  it('every read tool has readOnlyHint true; change and propose tools are not read-only; propose tools are idempotent; none is destructive or open-world', async () => {
    const { client } = await connect('propose');
    for (const listed of (await client.listTools()).tools) {
      const tool = AGENT_TOOLS.find((t) => t.name === listed.name)!;
      expect({ name: listed.name, annotations: listed.annotations }).toEqual({
        name: listed.name,
        annotations: {
          title: tool.title, readOnlyHint: tool.level === 'read' || tool.level === 'calc', destructiveHint: false, openWorldHint: false,
          ...(tool.level === 'propose' ? { idempotentHint: true } : {}),
        },
      });
      expect(listed.title).toBe(tool.title);
      expect(listed.description).toBe(tool.description);
    }
  });

  it('each tool’s input schema is its zod schema', async () => {
    const { client } = await connect('propose');
    for (const listed of (await client.listTools()).tools) {
      const tool = AGENT_TOOLS.find((t) => t.name === listed.name)!;
      const own = z.toJSONSchema(tool.input) as { properties?: Record<string, unknown>; required?: string[] };
      expect(Object.keys(listed.inputSchema.properties ?? {}).sort()).toEqual(Object.keys(own.properties ?? {}).sort());
      expect([...(listed.inputSchema.required ?? [])].sort()).toEqual([...(own.required ?? [])].sort());
    }
  });

  it('prompts and resources are listed, and read as the method gives them', async () => {
    const { client } = await connect('read');
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(AGENT_PROMPTS.map((p) => p.name));
    const after = AGENT_PROMPTS.find((p) => p.name === 'after_discovery_call')!;
    expect(prompts.find((p) => p.name === after.name)?.arguments?.map((a) => a.name)).toEqual(after.args);
    const got = await client.getPrompt({ name: after.name, arguments: { partner: 'Northwind' } });
    expect(got.messages).toEqual([{ role: 'user', content: { type: 'text', text: after.text({ partner: 'Northwind' }) } }]);
    const weekly = await client.getPrompt({ name: 'weekly_review' });
    expect(weekly.messages[0]?.content).toMatchObject({ type: 'text', text: AGENT_PROMPTS.find((p) => p.name === 'weekly_review')!.text({}) });

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(AGENT_RESOURCES.map((r) => r.uri));
    const stages = AGENT_RESOURCES[0]!;
    const read = await client.readResource({ uri: stages.uri });
    expect(read.contents).toEqual([{ uri: stages.uri, mimeType: 'text/markdown', text: stages.text }]);
  });

  it('a call runs the tool for the agent’s own company and carries structured content', async () => {
    const { client, deps } = await connect('read');
    // Anna opened Partners once, which makes her (empty) Partners file; an agent never makes one.
    expect((await readPartners(deps, { kind: 'owner', userId: 'u_anna', displayName: 'Anna' }, { companyId: 'co_aaaaaaaaaa' })).ok).toBe(true);
    const result = await client.callTool({ name: 'list_partners', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ items: [], nextCursor: null });
  });

  it('an unknown tool reaches runTool and answers not_found', async () => {
    const { client } = await connect('change');
    const result = await client.callTool({ name: 'move_stage', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(COPY.AGENT_NO_TOOL);
    expect(textOf(result)).toContain('code: not_found');
  });

  it('a change tool called by a read grant is forbidden, and nothing is written', async () => {
    const { client, deps } = await connect('read');
    const result = await client.callTool({
      name: 'log_call', arguments: { accountId: 'acc_aaaaaaaaaa', partnerType: 'reseller', date: '2026-10-28', kind: 'discovery', notes: 'x' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(COPY.FORBIDDEN);
    expect(textOf(result)).toContain('code: forbidden');
    expect(deps.events.events).toEqual([]);
  });

  it('input the tool’s schema refuses answers invalid with the field, in the tools’ own words', async () => {
    const { client } = await connect('read');
    const result = await client.callTool({ name: 'get_partner', arguments: { accountId: 'acc_aaaaaaaaaa', companyId: 'co_bbbbbbbbbb' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('code: invalid');
    expect(textOf(result)).toContain(`companyId: ${COPY.AGENT_UNKNOWN_FIELD}`);
  });
  it('a change-level agent’s propose call is forbidden through MCP, and nothing is written', async () => {
    const { client, deps } = await connect('change');
    const { partnerId, partnerUpdatedAt } = await withPartner(deps);
    deps.events.events.length = 0;
    const result = await client.callTool({
      name: 'propose_4c_scores',
      arguments: { partnerId, expectedUpdatedAt: partnerUpdatedAt, letters: { credibility: { score: 2, evidence: 'Known brand.' } } },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(COPY.FORBIDDEN);
    expect(textOf(result)).toContain('code: forbidden');
    const withdraw = await client.callTool({ name: 'withdraw_proposal', arguments: { proposalId: 'prp_aaaaaaaaaa' } });
    expect(textOf(withdraw)).toContain('code: forbidden');
    expect(deps.proposals.rows).toEqual([]);
    expect(deps.events.events).toEqual([]);
  });

  it('every decision kind is refused to a change-level agent through MCP', async () => {
    const { client, deps } = await connect('change');
    const { accountId, partnerUpdatedAt, marketId, hypothesisId } = await withPartner(deps);
    const book = async () => value(await readPartners(deps, anna, { companyId: CO })).value;
    const before = await book();
    const market = value(await readMarket(deps, anna, { marketId })).value;
    deps.events.events.length = 0;
    // Desk score, confirmed score, step, stage, close and signed: update_partner's schema has no such field.
    const decisions: Record<string, unknown> = {
      desk: { credibility: 2 }, confirmed: { credibility: 2 }, step: 'qualification', stage: 'onboarding', closed: 'no', signedDate: '2026-10-27',
    };
    for (const [field, set] of Object.entries(decisions)) {
      const result = await client.callTool({
        name: 'update_partner',
        arguments: { accountId, partnerTypes: [{ partnerType: 'reseller', expectedUpdatedAt: partnerUpdatedAt, whyItFits: 'x', [field]: set }] },
      });
      expect({ field, error: result.isError, code: (result.structuredContent as { error?: string }).error }).toEqual({ field, error: true, code: 'invalid' });
      expect((result.structuredContent as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({ [`partnerTypes.0.${field}`]: COPY.AGENT_UNKNOWN_FIELD });
    }
    // A hypothesis's and a market's status: update_market's schema has none.
    const hypothesis = await client.callTool({
      name: 'update_market', arguments: { marketId, hypothesis: { id: hypothesisId, expectedUpdatedAt: market.hypotheses[0]!.updatedAt, name: 'Banks in Austria', status: 'holds' } },
    });
    expect((hypothesis.structuredContent as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({ 'hypothesis.status': COPY.AGENT_UNKNOWN_FIELD });
    const status = await client.callTool({
      name: 'update_market', arguments: { marketId, market: { expectedUpdatedAt: market.info.updatedAt, marketName: 'Austria and Germany', status: 'validated', statusNote: 'x' } },
    });
    expect((status.structuredContent as { fieldErrors: Record<string, string> }).fieldErrors)
      .toEqual({ 'market.status': COPY.AGENT_UNKNOWN_FIELD, 'market.statusNote': COPY.AGENT_UNKNOWN_FIELD });
    // An import: no tool reaches it.
    for (const name of ['import_partners', 'add_partners']) {
      expect(textOf(await client.callTool({ name, arguments: { marketId, companies: [{ company: 'Globex' }] } }))).toContain('code: not_found');
    }
    // And through the propose tools: forbidden at change.
    const propose = await client.callTool({ name: 'propose_partners', arguments: { marketId, companies: [{ company: 'Globex' }], reason: 'x' } });
    expect(textOf(propose)).toContain('code: forbidden');
    expect(await book()).toEqual(before);
    expect(value(await readMarket(deps, anna, { marketId })).value).toEqual(market);
    expect(deps.events.events.filter((e) => e.actorKind === 'agent')).toEqual([]);
  });
});
