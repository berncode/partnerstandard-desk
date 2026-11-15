// @vitest-environment jsdom
// In COPY's words.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UnsubscribeForm } from './unsubscribe-form';

describe('UnsubscribeForm', () => {
  it('asks, unsubscribes on the button, then confirms', async () => {
    const onUnsubscribe = vi.fn(async () => ({ ok: true }));
    render(<UnsubscribeForm token="tok.sig" label="the weekly digest" initiallyDone={false} onUnsubscribe={onUnsubscribe} />);
    expect(screen.getByRole('heading', { name: 'Unsubscribe from the weekly digest?' })).toBeInTheDocument();
    expect(onUnsubscribe).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(onUnsubscribe).toHaveBeenCalledWith('tok.sig');
    expect(await screen.findByRole('heading', { name: 'You’re unsubscribed' })).toBeInTheDocument();
    expect(screen.getByText('You won’t get the weekly digest at this address any more. Other emails from PartnerStandard Desk aren’t affected.')).toBeInTheDocument();
  });

  it('says so straight away when the address already left', () => {
    render(<UnsubscribeForm token="tok.sig" label="the weekly digest" initiallyDone onUnsubscribe={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'You’re unsubscribed' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains a failure', async () => {
    render(<UnsubscribeForm token="tok.sig" label="the weekly digest" initiallyDone={false} onUnsubscribe={vi.fn(async () => ({ ok: false }))} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link doesn’t work any more.');
  });
});
