import { describe, expect, it } from 'vitest';
import { personOf, type Actor } from './actor';
import { record } from './result';
import { makeTestDeps } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };

describe('record', () => {
  it('records no read, for an agent or a person (owner, 2026-11-14)', async () => {
    const deps = makeTestDeps();
    await record(deps, agent, 'partners.read', 'f1', ['p1']);
    await record(deps, owner, 'partners.read', 'f1', ['p1']);
    await record(deps, owner, 'maps.notifyRead', 'f1', ['m1']);
    await record(deps, owner, 'files.export', 'f1', []);
    expect(deps.events.events).toHaveLength(0);
  });
  it('keeps a change command for an agent', async () => {
    const deps = makeTestDeps();
    await record(deps, agent, 'partners.change', 'f1', ['p1']);
    expect(deps.events.events.map((e) => [e.command, e.actorKind])).toEqual([['partners.change', 'agent']]);
  });
  it('record writes the proposal id of an owner acting on a proposal', async () => {
    const deps = makeTestDeps();
    const accepting: Actor = { ...owner, proposal: { id: 'prp_aaaaaaaaaa', agentName: 'Claude' } };
    await record(deps, accepting, 'partners.change', 'f1', ['p1'], 'setStep');
    // The proposals commands name it themselves: an agent proposing, the person rejecting.
    await record(deps, agent, 'proposals.create', 'f1', ['prp_bbbbbbbbbb', 'p1'], undefined, 'prp_bbbbbbbbbb');
    await record(deps, owner, 'partners.change', 'f1', ['p1']);
    expect(deps.events.events.map((e) => [e.command, e.change, e.proposalId])).toEqual([
      ['partners.change', 'setStep', 'prp_aaaaaaaaaa'], ['proposals.create', undefined, 'prp_bbbbbbbbbb'], ['partners.change', undefined, undefined],
    ]);
    expect(deps.events.events[2]).not.toHaveProperty('proposalId');
  });
  it('records who did it: on a company server the member, never the workspace (plan 15)', async () => {
    const deps = makeTestDeps();
    const member = { personId: 'u_ben', role: 'partnerManager' } as const;
    const ben: Actor = { kind: 'owner', userId: 'ws_aaaaaaaaaa', displayName: 'Ben', member };
    const bensAgent: Actor = { ...agent, userId: 'ws_aaaaaaaaaa', member };
    const link: Actor = { kind: 'link', userId: 'ws_aaaaaaaaaa', linkId: 'l1', mapId: 'map_1', personId: 'e_1', side: 'partner', name: 'Lena' };
    await record(deps, ben, 'partners.change', 'f1', ['p1']);
    await record(deps, bensAgent, 'partners.change', 'f1', ['p1']);
    await record(deps, owner, 'partners.change', 'f1', ['p1']);
    await record(deps, link, 'maps.change', 'f1', ['k1']);
    expect(deps.events.events.map((e) => [e.actorKind, e.actorUserId])).toEqual([
      ['owner', 'u_ben'], ['agent', 'u_ben'], ['owner', 'u1'], ['link', 'ws_aaaaaaaaaa'],
    ]);
    expect([ben, bensAgent, owner, link].map(personOf)).toEqual(['u_ben', 'u_ben', 'u1', 'ws_aaaaaaaaaa']);
  });
});
