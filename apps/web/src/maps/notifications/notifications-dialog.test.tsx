// @vitest-environment jsdom
// The notifications dialog, in COPY's words.
import { COPY } from '@partner-desk/copy';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsButton, NotificationsDialog } from './notifications-dialog';
import type { NotificationActions, NotificationSettingsView } from './notification-types';

const settings = { dueSoonDays: 3 as const, partnerDigest: false, partnerAlerts: 'instant' as const, timezone: 'Europe/Berlin', mailConfigured: true };

function setup(view: NotificationSettingsView = { ok: true, settings }) {
  const actions: NotificationActions = {
    load: vi.fn(async () => view),
    save: vi.fn(async () => ({ ok: true as const, message: COPY.MAP_NOTIFY_SAVED })),
  };
  render(<NotificationsDialog mapId="map_0123456789" open onOpenChange={() => {}} actions={actions} />);
  return { actions, user: userEvent.setup() };
}

describe('NotificationsDialog', () => {
  it('shows the MAP’s settings, and when emails go out', async () => {
    setup();
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(await within(dialog).findByRole('radio', { name: '3 days before' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: '1 day before' })).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Instant (within about 30 minutes)' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Send partners a weekly copy' })).not.toBeChecked();
    expect(within(dialog).getByText('Emails go out at 8:00 your time (Europe/Berlin). Change it in Settings.')).toBeInTheDocument();
    expect(within(dialog).queryByText(COPY.MAP_NOTIFY_NO_MAIL)).toBeNull();
  });

  it('saves the chosen settings and says so', async () => {
    const { actions, user } = setup();
    await user.click(await screen.findByRole('radio', { name: '7 days before' }));
    await user.click(screen.getByRole('radio', { name: 'Once a day' }));
    await user.click(screen.getByRole('checkbox', { name: 'Send partners a weekly copy' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(actions.save).toHaveBeenCalledWith('map_0123456789', { dueSoonDays: 7, partnerAlerts: 'daily', partnerDigest: true });
    expect(await screen.findByRole('status')).toHaveTextContent(COPY.MAP_NOTIFY_SAVED);
  });

  it('says when email isn’t set up', async () => {
    setup({ ok: true, settings: { ...settings, mailConfigured: false } });
    expect(await screen.findByText(COPY.MAP_NOTIFY_NO_MAIL)).toBeInTheDocument();
  });

  it('shows why the settings couldn’t load', async () => {
    setup({ ok: false, message: 'This MAP isn’t there any more.' });
    expect(await screen.findByRole('alert')).toHaveTextContent('This MAP isn’t there any more.');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('opens from the MAP page’s Notifications button', async () => {
    const actions: NotificationActions = { load: vi.fn(async () => ({ ok: true as const, settings })), save: vi.fn() };
    render(<NotificationsButton mapId="map_0123456789" actions={actions} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    expect(actions.load).toHaveBeenCalledWith('map_0123456789');
  });
});
