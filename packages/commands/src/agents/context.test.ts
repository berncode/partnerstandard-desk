import { describe, expect, it } from 'vitest';
import { actorLabel } from '../actor';
import { makeTestDeps } from '../testing';
import { agentContext } from './context';

const who = { userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change' as const, via: { kind: 'app' as const, clientId: 'c_claude' } };

describe('agentContext', () => {
  it('takes the company from companies.forUser', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_abcdefghij' } });
    const ctx = await agentContext(deps, who);
    expect(ctx.companyId).toBe('co_abcdefghij');
    expect(ctx.deps).toBe(deps);
    expect(ctx.actor).toEqual({ kind: 'agent', ...who });
  });
  it('carries the level and how the agent came in, by app or by key', async () => {
    const byKey = await agentContext(makeTestDeps(), { ...who, level: 'propose', via: { kind: 'key', keyId: 'k_1' } });
    expect(byKey.actor).toMatchObject({ level: 'propose', via: { kind: 'key', keyId: 'k_1' } });
  });
  it('cuts a 60-character agent name to 40 and names an empty one Agent', async () => {
    const deps = makeTestDeps();
    const long = await agentContext(deps, { ...who, agentName: `  ${'a'.repeat(60)}  ` });
    expect(long.actor.agentName).toBe('a'.repeat(40));
    expect((await agentContext(deps, { ...who, agentName: '   ' })).actor.agentName).toBe('Agent');
  });
  it('actorLabel of an agent context is "Desk Agent for Ruth"', async () => {
    const ctx = await agentContext(makeTestDeps(), who);
    expect(actorLabel(ctx.actor)).toBe('Desk Agent for Ruth');
  });
});
