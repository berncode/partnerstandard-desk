// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('./members-actions', () => ({
  changeMemberRole: vi.fn(), removeTeamMember: vi.fn(), inviteMember: vi.fn(), cancelInvitation: vi.fn(),
}));

const { MembersPanel } = await import('./members-panel');
const actions = await import('./members-actions');

const members = [
  { personId: 'u_anna', name: 'Anna', email: 'anna@halden.example', role: 'admin' as const, you: true },
  { personId: 'u_ben', name: 'Ben', email: 'ben@halden.example', role: 'partnerManager' as const, you: false },
];
const invite = {
  id: 'inv_1', email: 'cleo@halden.example', role: 'viewer' as const, invitedBy: 'u_anna', createdAt: '2026-11-08T10:00:00.000Z',
  expiresAt: '2026-11-15T10:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Settings, Members (plan 15, task 6)', () => {
  it('shows a partner manager or viewer the members and their roles, and nothing to change', () => {
    render(<MembersPanel initialMembers={members} initialInvites={[]} admin={false} timeZone="Europe/Berlin" />);
    expect(screen.getByText('Anna (you)')).toBeTruthy();
    expect(screen.getByText('ben@halden.example · Partner manager')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByText(COPY.INVITE_TITLE)).toBeNull();
  });

  it('lets an admin change a role, and says why when the last admin can’t change', async () => {
    vi.mocked(actions.changeMemberRole).mockResolvedValueOnce({ ok: false, message: COPY.MEMBERS_LAST_ADMIN });
    vi.mocked(actions.changeMemberRole).mockResolvedValueOnce({ ok: true, members: [members[0]!, { ...members[1]!, role: 'viewer' }] });
    render(<MembersPanel initialMembers={members} initialInvites={[]} admin timeZone="Europe/Berlin" />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role: Anna' }), 'viewer');
    expect((await screen.findByRole('alert')).textContent).toBe(COPY.MEMBERS_LAST_ADMIN);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role: Ben' }), 'viewer');
    expect((await screen.findByRole('status')).textContent).toBe('Ben’s role is now Viewer.');
    expect(actions.changeMemberRole).toHaveBeenLastCalledWith('u_ben', 'viewer');
    expect(refresh).not.toHaveBeenCalled();
    // No Remove on your own row: leaving is Delete account's.
    expect(screen.queryByRole('button', { name: 'Remove Anna' })).toBeNull();
  });

  it('asks for the page again after changing your own role', async () => {
    vi.mocked(actions.changeMemberRole).mockResolvedValue({ ok: true, members: [{ ...members[0]!, role: 'partnerManager' }, members[1]!] });
    render(<MembersPanel initialMembers={members} initialInvites={[]} admin timeZone="Europe/Berlin" />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role: Anna' }), 'partnerManager');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('asks before removing someone', async () => {
    vi.mocked(actions.removeTeamMember).mockResolvedValue({ ok: true, members: [members[0]!] });
    render(<MembersPanel initialMembers={members} initialInvites={[]} admin timeZone="Europe/Berlin" />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ben' }));
    expect(screen.getByText(COPY.MEMBERS_REMOVE_TEXT)).toBeTruthy();
    expect(actions.removeTeamMember).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: COPY.MEMBERS_REMOVE }));
    await waitFor(() => expect(screen.queryByText('Ben')).toBeNull());
    expect(actions.removeTeamMember).toHaveBeenCalledWith('u_ben');
  });

  it('invites an address with a role, lists the open invites, and cancels one', async () => {
    vi.mocked(actions.inviteMember).mockResolvedValue({ ok: true, invites: [invite], message: COPY.INVITE_SENT('cleo@halden.example') });
    vi.mocked(actions.cancelInvitation).mockResolvedValue({ ok: true, invites: [] });
    render(<MembersPanel initialMembers={members} initialInvites={[]} admin timeZone="Europe/Berlin" />);
    expect(screen.getByText(COPY.INVITES_NONE)).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: COPY.INVITE_EMAIL_LABEL }), 'cleo@halden.example');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: COPY.MEMBERS_ROLE_LABEL }), 'viewer');
    await userEvent.click(screen.getByRole('button', { name: COPY.INVITE_SEND }));
    expect(actions.inviteMember).toHaveBeenCalledWith('cleo@halden.example', 'viewer');
    expect((await screen.findByRole('status')).textContent).toBe(COPY.INVITE_SENT('cleo@halden.example'));
    expect(screen.getByText('Viewer · until 15 Nov 2026')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: `${COPY.INVITE_CANCEL}: cleo@halden.example` }));
    await waitFor(() => expect(screen.getByText(COPY.INVITES_NONE)).toBeTruthy());
  });

  it('shows the address field’s own error', async () => {
    vi.mocked(actions.inviteMember).mockResolvedValue({ ok: false, message: COPY.INVITE_ALREADY_MEMBER, fieldErrors: { email: COPY.INVITE_ALREADY_MEMBER } });
    render(<MembersPanel initialMembers={members} initialInvites={[]} admin timeZone="Europe/Berlin" />);
    await userEvent.type(screen.getByRole('textbox', { name: COPY.INVITE_EMAIL_LABEL }), 'ben@halden.example');
    await userEvent.click(screen.getByRole('button', { name: COPY.INVITE_SEND }));
    expect(await screen.findByText(COPY.INVITE_ALREADY_MEMBER)).toBeTruthy();
  });

  it('lines the address and the role up at the top, so the role’s hint never pushes the address field down', () => {
    render(<MembersPanel initialMembers={members} initialInvites={[]} admin timeZone="Europe/Berlin" />);
    const email = screen.getByRole('textbox', { name: COPY.INVITE_EMAIL_LABEL });
    const role = screen.getByRole('combobox', { name: COPY.MEMBERS_ROLE_LABEL });
    const row = email.closest('.flex-wrap')!;
    expect(row.contains(role)).toBe(true);
    expect(row).toHaveClass('items-start');
    expect(row).not.toHaveClass('items-end');
  });
});
