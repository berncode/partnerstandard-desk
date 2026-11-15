import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  signedIn: true,
  valid: true,
  url: 'http://127.0.0.1:5173/callback?code=c1&state=s' as string | null,
  answers: [] as Array<{ accept: boolean; scope: readonly string[]; oauthQuery: string }>,
  logged: [] as string[],
  role: undefined as undefined | 'admin' | 'partnerManager' | 'viewer',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: 'session=1' }) }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('@/server/log', () => ({ log: (event: string) => { state.logged.push(event); } }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => (state.signedIn
    ? { owner: { userId: 'u1', displayName: 'Anna' }, member: state.role ? { personId: 'u_anna', role: state.role } : null }
    : null),
  getAuth: () => ({}),
}));
vi.mock('@partner-desk/platform', async (orig) => {
  const real = await orig<typeof import('@partner-desk/platform')>();
  return {
    ...real,
    serverEnv: () => ({ APP_URL: 'http://localhost:3000' }),
    verifyAllowQuery: async () => state.valid,
    answerAllow: async (_auth: unknown, input: { accept: boolean; scope: readonly string[]; oauthQuery: string }) => {
      state.answers.push({ accept: input.accept, scope: input.scope, oauthQuery: input.oauthQuery });
      return state.url;
    },
  };
});

const { answerAgent } = await import('./actions');

const QUERY = 'client_id=c1&scope=pd.read+pd.change+offline_access&exp=1&sig=s';
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  Object.assign(state, { signedIn: true, valid: true, url: 'http://127.0.0.1:5173/callback?code=c1&state=s', answers: [], logged: [], role: undefined });
});

describe('answerAgent', () => {
  it('Allow with Read only allows pd.read and offline_access, and sends the browser back to the app', async () => {
    await expect(answerAgent(null, form({ oauth_query: QUERY, level: 'read', answer: 'allow' }))).rejects.toThrow('redirect:http://127.0.0.1:5173/callback?code=c1&state=s');
    expect(state.answers).toEqual([{ accept: true, scope: ['pd.read', 'offline_access'], oauthQuery: QUERY }]);
  });

  it('Allow with Read and change allows pd.change too', async () => {
    await expect(answerAgent(null, form({ oauth_query: QUERY, level: 'change', answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    expect(state.answers[0]?.scope).toEqual(['pd.read', 'pd.change', 'offline_access']);
  });

  it('Allow at the third level grants pd.read pd.change pd.propose offline_access', async () => {
    const all = 'client_id=c1&scope=pd.read+pd.change+pd.propose+offline_access&exp=1&sig=s';
    await expect(answerAgent(null, form({ oauth_query: all, level: 'propose', answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    expect(state.answers[0]?.scope).toEqual(['pd.read', 'pd.change', 'pd.propose', 'offline_access']);
  });

  it('Read only and Read and change drop pd.propose from an app that asked for it', async () => {
    const all = 'client_id=c1&scope=pd.read+pd.change+pd.propose+offline_access&exp=1&sig=s';
    await expect(answerAgent(null, form({ oauth_query: all, level: 'read', answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    await expect(answerAgent(null, form({ oauth_query: all, level: 'change', answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    // No level sent at all is the lowest asked for, never the third.
    await expect(answerAgent(null, form({ oauth_query: all, answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    expect(state.answers.map((a) => a.scope)).toEqual([['pd.read', 'offline_access'], ['pd.read', 'pd.change', 'offline_access'], ['pd.read', 'offline_access']]);
  });

  it('a company server’s viewer allows Read only alone, whatever level the form sends (plan 15)', async () => {
    state.role = 'viewer';
    const all = 'client_id=c1&scope=pd.read+pd.change+pd.propose+offline_access&exp=1&sig=s';
    await expect(answerAgent(null, form({ oauth_query: all, level: 'propose', answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    expect(state.answers[0]?.scope).toEqual(['pd.read', 'offline_access']);
    state.role = 'partnerManager';
    await expect(answerAgent(null, form({ oauth_query: all, level: 'propose', answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    expect(state.answers[1]?.scope).toEqual(['pd.read', 'pd.change', 'pd.propose', 'offline_access']);
  });

  it('never allows proposing to an app that didn’t ask for pd.propose', async () => {
    await expect(answerAgent(null, form({ oauth_query: QUERY, level: 'propose', answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    expect(state.answers[0]?.scope).toEqual(['pd.read', 'offline_access']);
  });

  it('never allows a level the app didn’t ask for', async () => {
    const readOnly = 'client_id=c1&scope=pd.read&exp=1&sig=s';
    await expect(answerAgent(null, form({ oauth_query: readOnly, level: 'change', answer: 'allow' }))).rejects.toThrow(/^redirect:/);
    expect(state.answers[0]?.scope).toEqual(['pd.read']);
  });

  it('Cancel allows nothing', async () => {
    await expect(answerAgent(null, form({ oauth_query: QUERY, level: 'change', answer: 'cancel' }))).rejects.toThrow(/^redirect:/);
    expect(state.answers).toEqual([{ accept: false, scope: [], oauthQuery: QUERY }]);
  });

  it('sends a signed-out person to sign in, and back to this request', async () => {
    state.signedIn = false;
    await expect(answerAgent(null, form({ oauth_query: QUERY, answer: 'allow' }))).rejects.toThrow(`redirect:/sign-in?next=${encodeURIComponent(`/oauth/allow?${QUERY}`)}`);
    expect(state.answers).toEqual([]);
  });

  it('refuses a request that isn’t signed or has run out, without asking the provider', async () => {
    state.valid = false;
    expect(await answerAgent(null, form({ oauth_query: QUERY, answer: 'allow' }))).toEqual({ message: 'PartnerStandard Desk couldn’t finish this. Go back to your app and connect again.' });
    expect(state.answers).toEqual([]);
  });

  it('says so, and logs the name only, when the provider gives nothing back', async () => {
    state.url = null;
    expect(await answerAgent(null, form({ oauth_query: QUERY, level: 'read', answer: 'allow' }))).toEqual({ message: 'PartnerStandard Desk couldn’t finish this. Go back to your app and connect again.' });
    expect(state.logged).toEqual(['agent_allow_failed']);
  });
});
