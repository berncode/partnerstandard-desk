import { COPY } from '@partner-desk/copy';
import { describe, expect, it } from 'vitest';
import type { AgentActor } from './actor';
import { appMaker, makerKey, makerOf } from './proposal-index';
import { describeProposalIndexContract } from './proposal-index.contract';
import { createMemoryProposals } from './testing';

describeProposalIndexContract('memory', async () => {
  const index = createMemoryProposals();
  return {
    index,
    allowApp: async (userId, clientId, appName) => index.allowApp(userId, clientId, appName),
    turnOffApp: async (userId, clientId) => index.turnOffApp(userId, clientId),
    addKey: async (userId, keyId, name) => index.addKey(userId, keyId, name),
    turnOffKey: async (userId, keyId) => index.turnOffKey(userId, keyId),
  };
});

const agent = (agentName: string, via: AgentActor['via']): AgentActor => ({
  kind: 'agent', userId: 'u_anna', displayName: 'Anna', agentName, level: 'propose', via,
});

describe('which agent made a proposal (spec 5.3)', () => {
  it('is the app’s name through MCP, never its client id, and the key through the API', () => {
    expect(makerOf(agent('Claude', { kind: 'app', clientId: 'c_claude' }))).toEqual({ kind: 'app', agentName: 'Claude', clientId: 'c_claude' });
    expect(makerKey(makerOf(agent('Claude', { kind: 'app', clientId: 'c_claude' })))).toBe('app:Claude');
    expect(makerKey(makerOf(agent('Claude', { kind: 'app', clientId: 'c_claude_2' })))).toBe('app:Claude');
    expect(makerOf(agent('n8n', { kind: 'key', keyId: 'ak_1' }))).toEqual({ kind: 'key', keyId: 'ak_1' });
    expect(makerKey({ kind: 'key', keyId: 'ak_1' })).toBe('key:ak_1');
  });

  it('is the client id for an app that registered without a name, so unnamed apps of one person stay apart', () => {
    // An app without a client_name acts under the fallback name ("Agent"): that name doesn't tell two such apps apart.
    const unnamed = agent(COPY.AGENT_FALLBACK_NAME, { kind: 'app', clientId: 'c_one' });
    expect(makerOf(unnamed)).toEqual({ kind: 'app', agentName: '', clientId: 'c_one' });
    expect(makerKey(makerOf(unnamed))).toBe('client:c_one');
    expect(makerKey(makerOf(agent(COPY.AGENT_FALLBACK_NAME, { kind: 'app', clientId: 'c_two' })))).toBe('client:c_two');
    // Settings and the index read the app's registered name, and come to the same key.
    expect(makerKey(appMaker('', 'c_one'))).toBe('client:c_one');
    expect(makerKey(appMaker('   ', 'c_one'))).toBe('client:c_one');
  });

  it('reads an app’s registered name as the agent sees it: trimmed and cut to 40 characters', () => {
    const long = `  ${'A'.repeat(45)}  `;
    expect(appMaker(long, 'c_1')).toEqual({ kind: 'app', agentName: 'A'.repeat(40), clientId: 'c_1' });
    expect(makerKey(appMaker(' Claude ', 'c_1'))).toBe('app:Claude');
  });
});
