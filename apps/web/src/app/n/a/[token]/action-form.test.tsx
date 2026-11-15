// @vitest-environment jsdom
// In COPY's words.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionOutcome, ConfirmView } from '@/server/email-actions';
import { ActionForm } from './action-form';

const view: ConfirmView = { action: 'done', partnerName: 'Acme', title: 'Send the pricing sheet', status: 'not_started', note: 'Draft ready', personName: 'Ben Ito' };

describe('ActionForm', () => {
  it('asks first, posts once on the button, then says what happened', async () => {
    const onConfirm = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true, message: 'Done: “Send the pricing sheet” is now done.' }));
    render(<ActionForm token="tok.sig" view={view} onConfirm={onConfirm} />);
    expect(screen.getByRole('heading', { name: 'Mark “Send the pricing sheet” done?' })).toBeInTheDocument();
    expect(screen.getByText('Acme · now Not started')).toBeInTheDocument();
    expect(screen.getByText('The MAP will show this change as made by Ben Ito.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mark done' }));
    expect(onConfirm).toHaveBeenCalledWith('tok.sig', {});
    expect(await screen.findByRole('status')).toHaveTextContent('Done: “Send the pricing sheet” is now done.');
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('offers the five statuses and a note for Update…', async () => {
    const onConfirm = vi.fn(async (): Promise<ActionOutcome> => ({ ok: true, message: 'Saved' }));
    render(<ActionForm token="tok.sig" view={{ ...view, action: 'update' }} onConfirm={onConfirm} />);
    expect(screen.getByRole('heading', { name: 'Update “Send the pricing sheet”' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['not_started', 'in_progress', 'blocked', 'done', 'na']);
    expect(screen.getByRole('radio', { name: 'Not started' })).toBeChecked();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Blocked' }));
    await user.clear(screen.getByLabelText('Note (optional)'));
    await user.type(screen.getByLabelText('Note (optional)'), 'Waiting for legal');
    await user.click(screen.getByRole('button', { name: 'Save update' }));
    expect(onConfirm).toHaveBeenCalledWith('tok.sig', { status: 'blocked', note: 'Waiting for legal' });
  });

  it('shows a refusal and keeps the button', async () => {
    const onConfirm = vi.fn(async (): Promise<ActionOutcome> => ({ ok: false, kind: 'limited', message: 'Too many requests. Try again later.' }));
    render(<ActionForm token="tok.sig" view={{ ...view, action: 'in_progress' }} onConfirm={onConfirm} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mark in progress' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again later.');
    expect(screen.getByRole('button', { name: 'Mark in progress' })).toBeEnabled();
  });
});
