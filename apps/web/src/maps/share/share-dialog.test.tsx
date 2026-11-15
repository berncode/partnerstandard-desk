// @vitest-environment jsdom
// Send link shows only once email is set up and a send action is given (task 8); someone taken off People has no name or address here.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShareButton, ShareDialog } from './share-dialog';
import type { ShareActions, ShareView } from './share-types';

const view = (overrides: Partial<Extract<ShareView, { ok: true }>> = {}): ShareView => ({
  ok: true, ourName: 'Acme Partners', partnerName: 'Brightwave Systems', mailConfigured: true,
  people: [
    { personId: 'p_ben001', name: 'Ben Ito', side: 'us', email: 'ben@example.com', lastUsedAt: null, active: false, inPlan: true },
    { personId: 'p_lena01', name: 'Lena Ortiz', side: 'partner', email: 'lena@example.com', lastUsedAt: '2026-10-18T09:00:00.000Z', active: true, inPlan: true },
  ],
  ...overrides,
});

function setup(initial: ShareView = view(), { withSend = true } = {}) {
  const actions: ShareActions = {
    load: vi.fn(async () => initial),
    copy: vi.fn(async () => ({ ok: true as const, url: 'https://desk.test/c/TOKEN' })),
    ...(withSend ? { send: vi.fn(async () => ({ ok: true as const, message: 'Link sent to ben@example.com.' })) } : {}),
    revoke: vi.fn(async () => ({ ok: true as const, message: 'Access removed.' })),
  };
  const user = userEvent.setup();
  render(<ShareDialog mapId="map_0123456789" open onOpenChange={() => {}} actions={actions} />);
  return { actions, user };
}

describe('ShareDialog', () => {
  it('lists people with an email on both sides, with when their link was last used', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Share this MAP' });
    expect(within(dialog).getByRole('heading', { name: 'Acme Partners' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Brightwave Systems' })).toBeInTheDocument();
    expect(await within(dialog).findByText('No link yet')).toBeInTheDocument();
    expect(within(dialog).getByText('Last used 18 Oct 2026')).toBeInTheDocument();
  });

  it('copies a new link for one person and shows it', async () => {
    const { actions, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Copy link for Lena Ortiz' }));
    expect(actions.copy).toHaveBeenCalledWith('map_0123456789', 'p_lena01');
    expect(await screen.findByDisplayValue('https://desk.test/c/TOKEN')).toBeInTheDocument();
    expect(screen.getByLabelText('Link for Lena Ortiz')).toHaveValue('https://desk.test/c/TOKEN');
  });

  it('emails a link and says where it went, once email is set up', async () => {
    const { actions, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Send link to Ben Ito' }));
    expect(actions.send).toHaveBeenCalledWith('map_0123456789', 'p_ben001');
    expect(await screen.findByText('Link sent to ben@example.com.')).toBeInTheDocument();
  });

  it('asks before revoking, then refreshes the list', async () => {
    const { actions, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke access for Lena Ortiz' }));
    expect(actions.revoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove access for Lena Ortiz' }));
    expect(actions.revoke).toHaveBeenCalledWith('map_0123456789', 'p_lena01');
    await waitFor(() => expect(actions.load).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Access removed.')).toBeInTheDocument();
  });

  it('moves focus into the confirm step and back to Revoke on cancel', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke access for Lena Ortiz' }));
    const remove = screen.getByRole('button', { name: 'Remove access for Lena Ortiz' });
    expect(remove).toHaveFocus();
    expect(remove).toHaveAccessibleDescription(/will lose access at once/);
    await user.click(screen.getByRole('button', { name: 'Cancel removing access for Lena Ortiz' }));
    expect(screen.getByRole('button', { name: 'Revoke access for Lena Ortiz' })).toHaveFocus();
  });

  it('drops a copied link once access is revoked', async () => {
    const actions: ShareActions = {
      load: vi.fn()
        .mockResolvedValueOnce(view())
        .mockResolvedValueOnce(view())
        .mockResolvedValue(view({ people: [
          { personId: 'p_lena01', name: 'Lena Ortiz', side: 'partner', email: 'lena@example.com', lastUsedAt: null, active: false, inPlan: true },
        ] })),
      copy: vi.fn(async () => ({ ok: true as const, url: 'https://desk.test/c/TOKEN' })),
      revoke: vi.fn(async () => ({ ok: true as const, message: 'Access removed.' })),
    };
    const user = userEvent.setup();
    render(<ShareDialog mapId="map_0123456789" open onOpenChange={() => {}} actions={actions} />);
    await user.click(await screen.findByRole('button', { name: 'Copy link for Lena Ortiz' }));
    expect(await screen.findByDisplayValue('https://desk.test/c/TOKEN')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke access for Lena Ortiz' }));
    await user.click(screen.getByRole('button', { name: 'Remove access for Lena Ortiz' }));
    await waitFor(() => expect(screen.queryByDisplayValue('https://desk.test/c/TOKEN')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('hides Send link until email is set up, says so, and offers Copy link', async () => {
    setup(view({ mailConfigured: false }));
    expect(await screen.findByRole('button', { name: 'Copy link for Ben Ito' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Send link/ })).toBeNull();
    expect(screen.getByText(/Email isn’t set up/)).toBeInTheDocument();
  });

  it('hides Send link without a send action, even when email is set up', async () => {
    setup(view(), { withSend: false });
    expect(await screen.findByRole('button', { name: 'Copy link for Ben Ito' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Send link/ })).toBeNull();
  });

  it('lists someone taken off People who still has access, with revoke only and no address', async () => {
    setup(view({ people: [{ personId: 'p_gone', name: null, side: 'partner', email: null, lastUsedAt: null, active: true, inPlan: false }] }));
    expect(await screen.findByText('No longer in this MAP')).toBeInTheDocument();
    expect(screen.getByText('Someone taken off People')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revoke access for Someone taken off People' })).toBeInTheDocument();
  });

  it('guides the owner when nobody has an email yet', async () => {
    setup(view({ people: [] }));
    expect(await screen.findByText(/Add an email address/)).toBeInTheDocument();
  });

  it('says when who has access can’t be loaded', async () => {
    setup({ ok: false, message: 'This MAP is no longer in PartnerStandard Desk.' });
    expect(await screen.findByRole('alert')).toHaveTextContent('This MAP is no longer in PartnerStandard Desk.');
  });
});

describe('ShareButton', () => {
  it('opens the dialog', async () => {
    const actions: ShareActions = { load: vi.fn(async () => view()), copy: vi.fn(), revoke: vi.fn() };
    const user = userEvent.setup();
    render(<ShareButton mapId="map_0123456789" actions={actions} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('dialog', { name: 'Share this MAP' })).toBeInTheDocument();
    expect(actions.load).toHaveBeenCalledWith('map_0123456789');
  });
});
