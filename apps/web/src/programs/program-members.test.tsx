// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramMembers } from './links';
import { RESELLER, showProgram, stubOutputs } from './test-harness';

vi.mock('next/navigation', () => ({ usePathname: () => '/programs/pg_resellerdd/why', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { ProgramMembersView } = await import('./program-members');

const MEMBERS: ProgramMembers = {
  partners: [
    { partnerId: 'p_tail', accountId: 'a_tail', company: 'Tailspin Solutions', partnerType: 'reseller', level: 'reg' },
    { partnerId: 'p_wing', accountId: 'a_wing', company: 'Wingtip Digital', partnerType: 'reseller', level: 'pref' },
    { partnerId: 'p_lit', accountId: 'a_lit', company: 'Litware Group', partnerType: 'reseller', level: 'reg' },
  ],
  markets: [{ marketId: 'm_austria', displayName: 'Austria · Reseller' }],
};

const region = () => screen.getByRole('region', { name: COPY.PROG_MEMBERS });

describe('a program’s partners and markets', () => {
  beforeEach(() => { stubOutputs(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('counts the partners per level by the program’s names, links each to its partner tab, and lists the markets that feed it', () => {
    showProgram(<ProgramMembersView members={{ ok: true, value: MEMBERS }} />, { program: { ...RESELLER, regName: 'Member', prefName: 'Gold' } });
    expect(region()).toHaveTextContent('Member: 2 · Gold: 1');
    const member = within(region()).getByRole('list', { name: 'Member' });
    expect(within(member).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Tailspin Solutions', '/partners/a_tail?type=reseller'], ['Litware Group', '/partners/a_lit?type=reseller'],
    ]);
    expect(within(region()).getByRole('list', { name: 'Gold' })).toHaveTextContent('Wingtip Digital');
    expect(within(region()).getByRole('link', { name: 'Austria · Reseller' })).toHaveAttribute('href', '/markets/m_austria');
    expect(region()).toHaveTextContent(COPY.PROG_FED_BY);
  });

  it('shows zero counts and says when no market feeds it', () => {
    showProgram(<ProgramMembersView members={{ ok: true, value: { partners: [], markets: [] } }} />);
    expect(region()).toHaveTextContent('Registered: 0 · Preferred: 0');
    expect(region()).toHaveTextContent(COPY.PROG_NO_MARKETS);
  });

  it('has no Preferred count with Preferred off, unless a partner still sits there', () => {
    showProgram(<ProgramMembersView members={{ ok: true, value: { partners: [MEMBERS.partners[0]!], markets: [] } }} />,
      { program: { ...RESELLER, prefOn: false } });
    expect(region()).toHaveTextContent('Registered: 1');
    expect(region()).not.toHaveTextContent('Preferred');
  });

  it('says so when they couldn’t be read, and the steps still show', () => {
    showProgram(<ProgramMembersView members={{ ok: false, message: 'Google is busy.' }} />);
    expect(region()).toHaveTextContent(COPY.PROG_MEMBERS_FAILED);
  });
});
