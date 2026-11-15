import { describe, expect, it } from 'vitest';
import { actorLabel, levelAtLeast, levelsWithinRole, levelWithinRole, withProposal, type Actor } from './actor';

describe('actorLabel', () => {
  it('labels the owner by name', () => {
    expect(actorLabel({ kind: 'owner', userId: 'u1', displayName: 'Ruth' })).toBe('Ruth');
  });
  it('labels an agent for its person', () => {
    const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };
    expect(actorLabel(agent)).toBe('Desk Agent for Ruth');
  });
  it('actorLabel of an owner with a proposal is "Ruth, proposed by Desk Agent"', () => {
    const owner = { kind: 'owner', userId: 'u1', displayName: 'Ruth' } as const;
    const accepting = withProposal(owner, { id: 'pr_1', agentName: 'Claude' });
    expect(accepting).toEqual({ ...owner, proposal: { id: 'pr_1', agentName: 'Claude' } });
    expect(actorLabel(accepting)).toBe('Ruth, proposed by Desk Agent');
    expect(owner).not.toHaveProperty('proposal');
  });
});

describe('levelAtLeast', () => {
  it('orders the levels read < change < propose', () => {
    const levels = ['read', 'change', 'propose'] as const;
    for (const [i, level] of levels.entries()) {
      for (const [j, floor] of levels.entries()) expect(levelAtLeast(level, floor)).toBe(i >= j);
    }
  });
});

describe('actorLabel for a person with a link', () => {
  const link: Actor = { kind: 'link', userId: 'u1', linkId: 'ml_1', mapId: 'map_1', personId: 'p_1', side: 'partner', name: 'Lena Ortiz' };
  it('labels them by their name and the link', () => {
    expect(actorLabel(link)).toBe('Lena Ortiz (by link)');
  });
  it('names someone whose name isn’t known', () => {
    expect(actorLabel({ ...link, name: ' ' })).toBe('Someone (by link)');
  });
});

describe('an agent within its member’s role (plan 15)', () => {
  it('reads only for a viewer; as its grant says for a partner manager, an admin and hosted', () => {
    for (const level of ['read', 'change', 'propose'] as const) {
      expect(levelWithinRole(level, 'viewer')).toBe('read');
      for (const role of ['partnerManager', 'admin', undefined] as const) expect(levelWithinRole(level, role)).toBe(level);
    }
    expect(levelsWithinRole(['read', 'change', 'propose'], 'viewer')).toEqual(['read']);
    expect(levelsWithinRole(['change'], 'viewer')).toEqual([]);
    expect(levelsWithinRole(['read', 'change', 'propose'], 'partnerManager')).toEqual(['read', 'change', 'propose']);
    expect(levelsWithinRole(['read', 'change'], undefined)).toEqual(['read', 'change']);
  });
});
