// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  valid: true,
  app: { name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] } as { name: string; redirectUris: string[] } | null,
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('./actions', () => ({ answerAgent: vi.fn() }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => ({ owner: { userId: 'u1', displayName: 'Anna' } }),
  getAuth: () => ({}),
  agentGrants: () => ({ app: async () => state.app }),
}));
vi.mock('@partner-desk/platform', async (orig) => ({
  ...(await orig<typeof import('@partner-desk/platform')>()),
  verifyAllowQuery: async () => state.valid,
}));

const { Question } = await import('./question');

/** The allow page's query as the provider signs it, with this return address. */
const ask = (redirectUri: string | undefined, scope = 'pd.read pd.change offline_access') => Question({
  searchParams: Promise.resolve({
    client_id: 'c1', scope, state: 'st', ...(redirectUri === undefined ? {} : { redirect_uri: redirectUri }), sig: 's',
  }),
});

beforeEach(() => {
  state.valid = true;
  state.app = { name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] };
});

describe('the allow page’s question', () => {
  it('shows where the app sends the person back: the host, never the path or the query', async () => {
    state.app = { name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback?from=desk'] };
    const { container } = render(await ask('https://claude.ai/api/mcp/auth_callback?from=desk'));
    expect(screen.getByRole('heading', { name: 'Allow Claude to use PartnerStandard Desk?' })).toBeInTheDocument();
    expect(screen.getByText(/^After you allow it, you go back to/)).toHaveTextContent('After you allow it, you go back to claude.ai.');
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    // The signed request rides along in the form's hidden field; on screen there is the host only.
    const shown = container.textContent ?? '';
    expect(shown).not.toContain('auth_callback');
    expect(shown).not.toContain('from=desk');
  });

  it('shows an address on this machine as it is', async () => {
    state.app = { name: 'Claude Code', redirectUris: ['http://localhost:5173/callback'] };
    render(await ask('http://localhost:5173/callback'));
    expect(screen.getByText('localhost:5173')).toBeInTheDocument();
  });

  it.each([
    ['claude.ai:/callback'],
    ['claude.ai://x/cb'],
  ])('names an app’s own scheme (%s) as an app on this device, never as the web address claude.ai', async (redirectUri) => {
    state.app = { name: 'Claude', redirectUris: [redirectUri] };
    const { container } = render(await ask(redirectUri));
    expect(screen.getByText(/^After you allow it, you go back to/))
      .toHaveTextContent('After you allow it, you go back to an app on this device (claude.ai:).');
    expect(screen.queryByText('claude.ai')).toBeNull();
    expect(container.textContent).not.toContain('go back to claude.ai');
    expect(container.textContent).not.toContain('claude.ai://x');
  });

  it.each([
    ['can’t be read', 'not an address'],
    ['is missing', undefined],
    ['isn’t one the app registered', 'https://evil.example/api/mcp/auth_callback'],
  ])('refuses, with nothing to allow, when the return address %s', async (_why, redirectUri) => {
    render(await ask(redirectUri));
    expect(screen.getByRole('heading', { name: 'This request has run out' })).toBeInTheDocument();
    expect(screen.getByText('Go back to your app and connect PartnerStandard Desk again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('refuses a request that isn’t signed, or names no registered app', async () => {
    state.valid = false;
    render(await ask('https://claude.ai/api/mcp/auth_callback'));
    expect(screen.getByRole('heading', { name: 'This request has run out' })).toBeInTheDocument();
    state.valid = true;
    state.app = null;
    render(await ask('https://claude.ai/api/mcp/auth_callback'));
    expect(screen.getAllByRole('heading', { name: 'This request has run out' })).toHaveLength(2);
  });

  it('the allow page offers three levels when the app asked for pd.propose, two otherwise', async () => {
    const back = 'https://claude.ai/api/mcp/auth_callback';
    const levels = () => screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value);
    const first = render(await ask(back, 'pd.read pd.change pd.propose offline_access'));
    expect(levels()).toEqual(['read', 'change', 'propose']);
    expect(screen.getByRole('radio', { name: /Read only/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Read, change and propose/ })).not.toBeChecked();
    first.unmount();
    const second = render(await ask(back));
    expect(levels()).toEqual(['read', 'change']);
    second.unmount();
    // pd.propose without pd.change offers no third level: proposing needs changing too.
    render(await ask(back, 'pd.read pd.propose offline_access'));
    expect(levels()).toEqual(['read']);
  });
});
