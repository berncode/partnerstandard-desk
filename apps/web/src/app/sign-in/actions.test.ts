import { beforeEach, describe, expect, it, vi } from 'vitest';

const toGoogle = async (): Promise<unknown> => ({ url: 'https://accounts.google.com/o/oauth2/auth?x=1' });
const state = vi.hoisted(() => ({
  signInSocial: null as unknown as () => Promise<unknown>,
  inputs: [] as unknown[],
  logged: [] as Array<[string, Record<string, string>]>,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('@/server/runtime', () => ({ getAuth: () => ({ api: { signInSocial: (input: unknown) => { state.inputs.push(input); return state.signInSocial(); } } }) }));
vi.mock('@/server/log', () => ({ log: (event: string, ids: Record<string, string>) => { state.logged.push([event, ids]); } }));

const { continueWithGoogle } = await import('./actions');
const form = (next: string) => { const f = new FormData(); f.set('next', next); return f; };

beforeEach(() => {
  state.signInSocial = toGoogle;
  state.inputs = [];
  state.logged = [];
});

describe('continueWithGoogle', () => {
  it('sends the person to Google and logs nothing', async () => {
    await expect(continueWithGoogle(form('/partners'))).rejects.toThrow('redirect:https://accounts.google.com/o/oauth2/auth?x=1');
    expect(state.logged).toEqual([]);
    // Only the provider and the way back: the scopes and Google's parameters are fixed in buildAuth.
    expect(state.inputs).toEqual([{ body: { provider: 'google', callbackURL: '/partners' }, headers: expect.any(Headers) }]);
  });

  it('carries an agent app’s signed request through Google, so the person comes back to the allow page', async () => {
    const data = form('/oauth/allow?client_id=c1&sig=s');
    data.set('oauth_query', 'client_id=c1&sig=s');
    await expect(continueWithGoogle(data)).rejects.toThrow(/^redirect:https:\/\/accounts\.google\.com\//);
    expect(state.inputs).toEqual([{
      body: { provider: 'google', callbackURL: '/oauth/allow?client_id=c1&sig=s', oauth_query: 'client_id=c1&sig=s' }, headers: expect.any(Headers),
    }]);
  });

  it('logs a failed start by name only, without its message, and shows the sign-in error', async () => {
    state.signInSocial = async () => { throw new Error('secret detail from Google: client_secret=abc'); };
    await expect(continueWithGoogle(form('/partners'))).rejects.toThrow('redirect:/sign-in?error=failed&next=%2Fpartners');
    expect(state.logged).toEqual([['sign_in_start_failed', {}]]);
  });
});
