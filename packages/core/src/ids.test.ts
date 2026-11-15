import { describe, expect, it } from 'vitest';
import { newCompanyId, newId, newInviteId, newMarketId, newProposalId, newWorkspaceId } from './ids';

describe('ids', () => {
  it('prefixes every id by kind', () => {
    expect(newId('partner')).toMatch(/^p_[0-9a-z]{6}$/);
    expect(newMarketId()).toMatch(/^m_[0-9a-z]{10}$/);
    expect(newCompanyId()).toMatch(/^co_[0-9a-z]{10}$/);
    expect(newProposalId()).toMatch(/^prp_[0-9a-z]{10}$/);
    expect(newWorkspaceId()).toMatch(/^ws_[0-9a-z]{10}$/);
    expect(newInviteId()).toMatch(/^inv_[0-9a-z]{16}$/);
  });
  it('uses the agreed prefix for each kind', () => {
    const prefixes = { partner: 'p', person: 'e', call: 'k', qualification: 'q', marketLink: 'l', valuePoint: 'v', hypothesis: 'h', exclusion: 'x', change: 'g' } as const;
    for (const [kind, prefix] of Object.entries(prefixes)) {
      expect(newId(kind as keyof typeof prefixes)).toMatch(new RegExp(`^${prefix}_[0-9a-z]{6}$`));
    }
  });
});
