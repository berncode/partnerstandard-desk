import { createWebhook, readPartners, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const state = vi.hoisted(() => ({
  grants: async (): Promise<unknown[]> => [],
  keys: async (): Promise<unknown[]> => [],
}));
vi.mock('@/server/runtime', () => ({
  agentGrants: () => ({ list: () => state.grants() }),
  apiKeys: () => ({ list: () => state.keys() }),
  appUrl: () => 'https://desk.example.com',
}));

const { agentsPanelData } = await import('./agents-data');

const anna: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'google', personId: 'u_anna', member: null };
const actor: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };

/** Anna with her Partners file: the count is of that file's proposals. */
async function withPartners() {
  const deps = makeTestDeps({ companies: { u_anna: 'co_annaanna01' } });
  await readPartners(deps, actor, { companyId: 'co_annaanna01' });
  return deps;
}

function logged() {
  const lines: Array<{ event: string; ids: Record<string, string> }> = [];
  return { lines, log: (event: string, ids: Record<string, string>) => { lines.push({ event, ids }); } };
}

beforeEach(() => {
  state.grants = async () => [];
  state.keys = async () => [];
});

describe('agentsPanelData (Settings, "Agents and API")', () => {
  it('reads the agents, keys and webhooks with their deliveries', async () => {
    const deps = makeTestDeps();
    await createWebhook(deps, actor, { url: 'https://hooks.example.com/in', events: ['partner.signed'] });
    const { lines, log } = logged();
    const data = await agentsPanelData(anna, deps, actor, 'Europe/Berlin', log);
    expect(data).toMatchObject({
      connectorUrl: 'https://desk.example.com/mcp', personName: 'Anna', timeZone: 'Europe/Berlin', agents: [], keys: [],
      webhooks: [{ url: 'https://hooks.example.com/in', deliveries: [] }], proposalsWaiting: {}, makerKeys: { apps: {}, keys: {} },
    });
    expect(lines).toEqual([]);
  });

  it('counts the waiting proposals by agent, as the index does: one app under two client ids counts once', async () => {
    state.grants = async () => [
      { clientId: 'c_old', appName: 'Claude', level: 'propose', allowedAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null },
      { clientId: 'c_new', appName: ' Claude ', level: 'propose', allowedAt: '2026-11-03T09:00:00.000Z', lastUsedAt: null },
      { clientId: 'c_unnamed', appName: '', level: 'propose', allowedAt: '2026-11-03T09:00:00.000Z', lastUsedAt: null },
    ];
    state.keys = async () => [{ id: 'ak_n8n', name: 'n8n', level: 'propose', prefix: 'pd_abcde', createdAt: '2026-11-01T09:00:00.000Z', lastUsedAt: null }];
    const deps = await withPartners();
    const asked: string[] = [];
    deps.proposals.countWaiting = async (userId) => {
      asked.push(userId);
      return { total: 4, byMaker: { 'app:Claude': 2, 'key:ak_n8n': 1, 'client:c_unnamed': 1 } };
    };
    const data = await agentsPanelData(anna, deps, actor, 'Europe/Berlin', logged().log);
    expect(asked).toEqual(['u_anna']);
    expect(data?.proposalsWaiting).toEqual({ 'app:Claude': 2, 'key:ak_n8n': 1, 'client:c_unnamed': 1 });
    expect(data?.makerKeys).toEqual({ apps: { c_old: 'app:Claude', c_new: 'app:Claude', c_unnamed: 'client:c_unnamed' }, keys: { ak_n8n: 'key:ak_n8n' } });
  });

  it('a count that fails shows the lists without counts, logged by the error’s name only', async () => {
    const deps = await withPartners();
    deps.proposals.countWaiting = async () => { throw new RangeError('SECRET Acme'); };
    const { lines, log } = logged();
    const data = await agentsPanelData(anna, deps, actor, 'Europe/Berlin', log);
    expect(data).toMatchObject({ agents: [], keys: [], proposalsWaiting: {} });
    expect(lines).toEqual([{ event: 'settings_proposals_count_failed', ids: { userId: 'u_anna', error: 'RangeError' } }]);
  });

  it('a list that fails to load answers null, logged by the error’s name only', async () => {
    state.keys = async () => { throw new TypeError('SECRET database text pd_secretkey'); };
    const { lines, log } = logged();
    expect(await agentsPanelData(anna, makeTestDeps(), actor, 'Europe/Berlin', log)).toBeNull();
    expect(lines).toEqual([{ event: 'settings_agents_failed', ids: { userId: 'u_anna', error: 'TypeError' } }]);
  });

  it('a failed webhooks read answers null too, never an empty list (“No webhooks yet.”)', async () => {
    const deps = makeTestDeps();
    deps.webhooks.list = async () => { throw new Error('SECRET https://hooks.example.com/in'); };
    const { lines, log } = logged();
    expect(await agentsPanelData(anna, deps, actor, 'Europe/Berlin', log)).toBeNull();
    expect(lines).toEqual([{ event: 'settings_agents_failed', ids: { userId: 'u_anna', error: 'Error' } }]);
    // A refusal from the commands, not a throw, the same.
    const link: Actor = { kind: 'link', userId: 'u_anna', linkId: 'ml_1', mapId: 'map_1', personId: 'pp_1', side: 'partner', name: 'Lena' };
    expect(await agentsPanelData(anna, makeTestDeps(), link, 'Europe/Berlin', log)).toBeNull();
    expect(lines[1]).toEqual({ event: 'settings_agents_failed', ids: { userId: 'u_anna', error: 'forbidden' } });
  });
});
