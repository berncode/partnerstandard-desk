// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RenewForm } from './renew-form';

describe('RenewForm', () => {
  it('asks for a new link for the expired link’s MAP and shows the neutral answer', async () => {
    const onRequest = vi.fn(async () => ({ ok: true as const, message: COPY.MAP_RELINK_SENT }));
    const user = userEvent.setup();
    render(<RenewForm mapId="map_0123456789" onRequest={onRequest} />);
    await user.type(screen.getByLabelText('Email address'), 'lena@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a new link' }));
    expect(onRequest).toHaveBeenCalledWith('map_0123456789', 'lena@example.com');
    expect(await screen.findByRole('status')).toHaveTextContent('a new link is on its way');
  });

  it('shows a refusal as an alert: email isn’t set up yet', async () => {
    const onRequest = vi.fn(async () => ({ ok: false as const, message: COPY.MAP_RELINK_NO_MAIL }));
    const user = userEvent.setup();
    render(<RenewForm mapId="map_0123456789" onRequest={onRequest} />);
    await user.type(screen.getByLabelText('Email address'), 'lena@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a new link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email isn’t set up here');
  });

  it('says something went wrong when the request fails', async () => {
    const onRequest = vi.fn(async () => { throw new Error('down'); });
    const user = userEvent.setup();
    render(<RenewForm mapId="map_0123456789" onRequest={onRequest} />);
    await user.type(screen.getByLabelText('Email address'), 'lena@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a new link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.SOMETHING_WRONG);
  });
});
