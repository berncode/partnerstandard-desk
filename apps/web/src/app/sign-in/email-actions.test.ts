import { createTestDb } from '@partner-desk/platform/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown, asked: [] as Array<{ email: string; next: string }>, redeemed: true, tokens: [] as string[], signIn: 'email' as 'google' | 'email', askOk: true }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw Object.assign(new Error('redirect'), { to }); } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }) }));
vi.mock('@/server/runtime', () => ({ getAuth: () => ({}), getDb: () => state.db }));
vi.mock('@/server/edition', () => ({ servedSignIn: () => state.signIn }));
vi.mock('@/server/log', () => ({ log: vi.fn() }));
vi.mock('@partner-desk/platform', async (orig) => ({
  ...(await orig<typeof import('@partner-desk/platform')>()),
  serverEnv: () => ({ BETTER_AUTH_SECRET: 'x'.repeat(32) }),
  requestSignInLink: async (_auth: unknown, email: string, _h: Headers, next: string) => { state.asked.push({ email, next }); return state.askOk; },
  redeemSignInLink: async (_auth: unknown, token: string) => { state.tokens.push(token); return state.redeemed ? new Headers({ 'set-cookie': 'x=1' }) : null; },
}));

const { confirmSignIn, emailSignInLink } = await import('./actions');

/** The limit's rows, read with the database's own client (the web app has no query builder of its own). */
const limitRows = async (): Promise<unknown[]> => (await (state.db as { $client: { execute(q: string): Promise<{ rows: unknown[] }> } }).$client.execute('select * from rate_limits')).rows;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const goesTo = (run: Promise<unknown>) => run.then(() => 'no redirect', (e: { to?: string }) => e.to);

describe('the email sign-in actions (plan 14, task 4)', () => {
  beforeEach(async () => {
    state.db = await createTestDb();
    state.asked = [];
    state.redeemed = true;
    state.tokens = [];
    state.signIn = 'email';
    state.askOk = true;
  });

  it('asks for a link and says it is on its way, carrying where it goes on to', async () => {
    expect(await goesTo(emailSignInLink(form({ email: ' Anna@Acme.Example ', next: '/oauth/allow?sig=a' })))).toBe('/sign-in?link=sent&next=%2Foauth%2Fallow%3Fsig%3Da');
    expect(state.asked).toEqual([{ email: 'anna@acme.example', next: '/oauth/allow?sig=a' }]);
  });

  it('keeps no address or network address in the limit’s keys, and says so when a link couldn’t be sent', async () => {
    await goesTo(emailSignInLink(form({ email: 'anna@acme.example' })));
    const keys = JSON.stringify(await limitRows());
    expect(keys).toContain('sign-in-link:');
    expect(keys).not.toContain('anna');
    expect(keys).not.toContain('203.0.113.7');
    state.askOk = false;
    expect(await goesTo(emailSignInLink(form({ email: 'anna@acme.example' })))).toBe('/sign-in?link=failed');
  });

  it('on hosted, neither action does anything but send the person back to sign-in', async () => {
    state.signIn = 'google';
    expect(await goesTo(emailSignInLink(form({ email: 'anna@acme.example' })))).toBe('/sign-in');
    expect(await goesTo(confirmSignIn(form({ token: 't'.repeat(32) })))).toBe('/sign-in');
    expect(state.asked).toEqual([]);
    expect(state.tokens).toEqual([]);
    expect(await limitRows()).toEqual([]);
  });

  it('refuses what isn’t one email address, asking for nothing', async () => {
    for (const email of ['', 'anna', 'anna@acme', 'a b@acme.example', `${'x'.repeat(250)}@acme.example`]) {
      expect(await goesTo(emailSignInLink(form({ email })))).toBe('/sign-in?link=bad_email');
    }
    expect(state.asked).toEqual([]);
  });

  it('stops after three links to one address in 15 minutes, and after ten from one network address', async () => {
    for (let i = 0; i < 3; i++) expect(await goesTo(emailSignInLink(form({ email: 'anna@acme.example' })))).toBe('/sign-in?link=sent');
    expect(await goesTo(emailSignInLink(form({ email: 'anna@acme.example' })))).toBe('/sign-in?link=too_many');
    for (let i = 0; i < 6; i++) await goesTo(emailSignInLink(form({ email: `p${i}@acme.example` })));
    expect(await goesTo(emailSignInLink(form({ email: 'last@acme.example' })))).toBe('/sign-in?link=too_many');
    expect(state.asked).toHaveLength(9);
  });

  it('the confirm button signs in and goes on, inside the app only; a used link goes back to sign-in', async () => {
    expect(await goesTo(confirmSignIn(form({ token: 't'.repeat(32), next: '/partners' })))).toBe('/partners');
    expect(state.tokens).toEqual(['t'.repeat(32)]);
    expect(await goesTo(confirmSignIn(form({ token: 't'.repeat(32), next: 'https://evil.example/' })))).toBe('/this-week');
    state.redeemed = false;
    expect(await goesTo(confirmSignIn(form({ token: 't'.repeat(32), next: '/partners' })))).toBe('/sign-in?link=gone&next=%2Fpartners');
  });
});
