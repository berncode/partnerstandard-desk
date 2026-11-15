// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AllowForm, type AllowState } from './allow-form';

const QUERY = 'client_id=c1&scope=pd.read+pd.change+offline_access&sig=s';

describe('AllowForm', () => {
  it('names the app and the person, says it can be turned off, and picks Read only first', () => {
    render(<AllowForm appName="Claude" returnTo={{ kind: 'web', host: 'claude.ai' }} personName="Anna Keller" levels={['read', 'change']} oauthQuery={QUERY} answer={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Allow Claude to use PartnerStandard Desk?' })).toBeInTheDocument();
    expect(screen.getByText('It acts in your name, Anna Keller, with your access. You can turn it off in Settings at any time.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Read only/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Read and change/ })).not.toBeChecked();
    expect(screen.getByText('It can see your partners, markets, programs, cases, MAPs and reviews.')).toBeInTheDocument();
    expect(screen.getByText('It can also log calls, update MAP activities and fill in reviews. It can never sign, close, move a stage or send anything to a partner.')).toBeInTheDocument();
  });

  it('says where the app sends the person back, the address set apart so a look-alike stands out', () => {
    render(<AllowForm appName="Claude" returnTo={{ kind: 'web', host: 'claude.ai' }} personName="Anna" levels={['read']} oauthQuery={QUERY} answer={vi.fn()} />);
    expect(screen.getByText(/^After you allow it, you go back to/)).toHaveTextContent('After you allow it, you go back to claude.ai.');
    const host = screen.getByText('claude.ai');
    expect(host.tagName).toBe('STRONG');
    expect(host).toHaveClass('font-mono');
  });

  it('names an app’s own scheme as an app on this device, never as a web address', () => {
    render(<AllowForm appName="Claude" returnTo={{ kind: 'app', scheme: 'claude.ai:' }} personName="Anna" levels={['read']} oauthQuery={QUERY} answer={vi.fn()} />);
    expect(screen.getByText(/^After you allow it, you go back to/)).toHaveTextContent('After you allow it, you go back to an app on this device (claude.ai:).');
    const scheme = screen.getByText('claude.ai:');
    expect(scheme.tagName).toBe('STRONG');
    expect(scheme).toHaveClass('font-mono');
  });

  it('offers only the levels the app asked for', () => {
    render(<AllowForm appName="Claude" returnTo={{ kind: 'web', host: 'claude.ai' }} personName="Anna" levels={['read']} oauthQuery={QUERY} answer={vi.fn()} />);
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['read']);
  });

  it('sends Allow with the level picked and the request, or Cancel', async () => {
    const answer = vi.fn<(previous: AllowState, form: FormData) => Promise<AllowState>>(async () => null);
    const user = userEvent.setup();
    render(<AllowForm appName="Claude" returnTo={{ kind: 'web', host: 'claude.ai' }} personName="Anna" levels={['read', 'change']} oauthQuery={QUERY} answer={answer} />);
    await user.click(screen.getByRole('radio', { name: /Read and change/ }));
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    const allowed = answer.mock.calls[0]?.[1] as FormData;
    expect(Object.fromEntries(allowed.entries())).toEqual({ oauth_query: QUERY, level: 'change', answer: 'allow' });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const cancelled = answer.mock.calls[1]?.[1] as FormData;
    expect(cancelled.get('answer')).toBe('cancel');
  });

  it('says so when the answer didn’t go through', async () => {
    const answer = vi.fn(async (): Promise<AllowState> => ({ message: 'PartnerStandard Desk couldn’t finish this. Go back to your app and connect again.' }));
    render(<AllowForm appName="Claude" returnTo={{ kind: 'web', host: 'claude.ai' }} personName="Anna" levels={['read']} oauthQuery={QUERY} answer={answer} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PartnerStandard Desk couldn’t finish this.');
  });

  it('names the third level and what it can do, with Read only still picked first', () => {
    render(<AllowForm appName="Claude" returnTo={{ kind: 'web', host: 'claude.ai' }} personName="Anna" levels={['read', 'change', 'propose']} oauthQuery={QUERY} answer={vi.fn()} />);
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['read', 'change', 'propose']);
    expect(screen.getByRole('radio', { name: /Read only/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Read, change and propose/ })).not.toBeChecked();
    expect(screen.getByText('It can also propose 4C scores, moving a stage, closing, signing, new partners and the status of a hypothesis or a market. Each proposal waits for you in PartnerStandard Desk. Nothing changes until you accept it.')).toBeInTheDocument();
  });

  it('sends Allow with the third level when the person picks it', async () => {
    const answer = vi.fn<(previous: AllowState, form: FormData) => Promise<AllowState>>(async () => null);
    const user = userEvent.setup();
    render(<AllowForm appName="Claude" returnTo={{ kind: 'web', host: 'claude.ai' }} personName="Anna" levels={['read', 'change', 'propose']} oauthQuery={QUERY} answer={answer} />);
    await user.click(screen.getByRole('radio', { name: /Read, change and propose/ }));
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect((answer.mock.calls[0]?.[1] as FormData).get('level')).toBe('propose');
  });
});

