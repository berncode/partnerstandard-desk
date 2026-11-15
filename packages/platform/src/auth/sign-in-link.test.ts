import { sql } from 'drizzle-orm';
import { testUtils } from 'better-auth/plugins';
import { describe, expect, it, vi } from 'vitest';
import { user } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { TursoWorkspace } from '../db/turso-workspace';
import { parseEnv } from '../env';
import { buildAuth } from './auth-config';
import { mayUseSignInLink, redeemSignInLink, requestSignInLink, SIGN_IN_LINK_SECONDS, signInLinkEmail, signInLinkPlugin } from './sign-in-link';

const companyServer = (overrides: Record<string, string> = {}) => parseEnv({
  DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), EDITION: 'self-hosted', APP_URL: 'https://desk.acme.example',
  ADMIN_EMAIL: 'anna@acme.example', ...overrides,
});
const headers = () => new Headers({ origin: 'https://desk.acme.example', 'user-agent': 'test' });

async function setup(overrides: Record<string, string> = {}) {
  const db = await createTestDb();
  const sent: Array<{ email: string; token: string; next: string }> = [];
  const env = companyServer(overrides);
  const auth = buildAuth({ db, env, sendSignInLink: async (link) => { sent.push(link); } });
  return { db, auth, sent, env };
}

describe('the email link on a company server (plan 14, task 2)', () => {
  it('sends the first admin a link that signs in once, and stores the token only hashed', async () => {
    const { db, auth, sent } = await setup();
    expect(await requestSignInLink(auth, '  Anna@Acme.Example ', headers())).toBe(true);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent).toEqual([{ email: 'anna@acme.example', token: expect.stringMatching(/^[A-Za-z]{32}$/), next: '/this-week' }]);
    const { token } = sent[0]!;
    expect(JSON.stringify(await db.all(sql`select identifier, value from verification`))).not.toContain(token);
    expect(await signInLinkEmail(auth, token)).toBe('anna@acme.example');
    // Reading the address leaves the link working.
    const signedIn = await redeemSignInLink(auth, token, headers());
    expect(signedIn?.get('set-cookie')).toContain('session_token');
    expect(await redeemSignInLink(auth, token, headers())).toBeNull();
    expect(await signInLinkEmail(auth, token)).toBeNull();
    expect(await db.all(sql`select email, email_verified from user`)).toEqual([{ email: 'anna@acme.example', email_verified: 1 }]);
  });

  it('the link goes on to where the person was going, never to another site', async () => {
    const { auth, sent } = await setup();
    await requestSignInLink(auth, 'anna@acme.example', headers(), '/oauth/allow?client_id=abc&sig=xyz');
    await requestSignInLink(auth, 'anna@acme.example', headers(), 'https://evil.example/');
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.next)).toEqual(['/oauth/allow?client_id=abc&sig=xyz', '/this-week']);
  });

  it('Better Auth’s own route to ask for a link answers 404: only the app’s page asks, with its limits (task 4’s review)', async () => {
    const { auth, sent } = await setup();
    const asked = await auth.handler(new Request('https://desk.acme.example/api/auth/sign-in/magic-link', {
      method: 'POST', headers: { ...Object.fromEntries(headers()), 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'anna@acme.example', callbackURL: 'https://evil.example/' }),
    }));
    expect(asked.status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
  });

  it('sends nothing to any other address, makes no user, and answers the same', async () => {
    const { db, auth, sent } = await setup();
    expect(await requestSignInLink(auth, 'mallory@elsewhere.example', headers())).toBe(true);
    // The checks run after the answer: once the admin's link, asked after, is out, Mallory's had its turn.
    await requestSignInLink(auth, 'anna@acme.example', headers());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.map((l) => l.email)).toEqual(['anna@acme.example']);
    // Whatever route would make the user, the hook refuses it (task 2's review).
    const made = await (await auth.$context).internalAdapter.createUser({ email: 'mallory@elsewhere.example', name: 'M', emailVerified: true }, { method: 'magic-link' });
    expect(made).toBeNull();
    expect(await db.all(sql`select email from user`)).toEqual([]);
  });

  it('logs a check the database couldn’t answer, without the address, and sends nothing', async () => {
    const db = await createTestDb();
    const sent: unknown[] = [];
    const logged: string[] = [];
    const env = companyServer();
    const plugin = signInLinkPlugin(env, db, async (link) => { sent.push(link); }, (event) => { logged.push(event); });
    await db.run(sql`DROP TABLE workspace_members`);
    await (plugin.options as { sendMagicLink: (i: { email: string; token: string; url: string }) => Promise<void> })
      .sendMagicLink({ email: 'anna@acme.example', token: 't', url: 'https://desk.acme.example/x?callbackURL=%2Fthis-week' });
    await vi.waitFor(() => expect(logged).toEqual(['sign_in_link_check_failed']));
    expect(sent).toEqual([]);
  });

  it('a link past its 15 minutes no longer signs in', async () => {
    const { auth, sent } = await setup();
    await requestSignInLink(auth, 'anna@acme.example', headers());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    vi.useFakeTimers({ now: Date.now() + (SIGN_IN_LINK_SECONDS + 1) * 1000, toFake: ['Date'] });
    try {
      expect(await signInLinkEmail(auth, sent[0]!.token)).toBeNull();
      expect(await redeemSignInLink(auth, sent[0]!.token, headers())).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the plugin’s own link, a GET that would sign in on a visit, answers 404 and leaves the link working', async () => {
    const { auth, sent } = await setup();
    await requestSignInLink(auth, 'anna@acme.example', headers());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const visit = await auth.handler(new Request(`https://desk.acme.example/api/auth/magic-link/verify?token=${sent[0]!.token}`, { headers: headers() }));
    expect(visit.status).toBe(404);
    expect(await redeemSignInLink(auth, sent[0]!.token, headers())).not.toBeNull();
  });

  it('a token that isn’t one is refused, and never looked up', async () => {
    const { auth } = await setup();
    const lookup = vi.spyOn((await auth.$context).internalAdapter, 'findVerificationValue');
    for (const bad of ['', 'short', 'x'.repeat(200), 'abc/def?ghi=jkl&mno']) {
      expect(await signInLinkEmail(auth, bad)).toBeNull();
      expect(await redeemSignInLink(auth, bad, headers())).toBeNull();
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('offers no Google sign-in on a company server, and test sign-in makes only its own users', async () => {
    const db = await createTestDb();
    const env = companyServer({ APP_URL: 'http://localhost:3000', PD_TEST_AUTH: '1' });
    const auth = buildAuth({ db, env, plugins: [testUtils()] });
    expect(auth.options.socialProviders?.google).toBeUndefined();
    const test = ((await auth.$context) as unknown as { test: { createUser(i: { email: string; name: string }): unknown; saveUser(u: unknown): Promise<unknown> } }).test;
    await test.saveUser(test.createUser({ email: 'test-abc123@example.test', name: 'Test' }));
    const refused = await test.saveUser(test.createUser({ email: 'mallory@elsewhere.example', name: 'M' })).then((u) => u, () => null);
    expect(refused ?? null).toBeNull();
    expect(await db.all(sql`select email from user`)).toEqual([{ email: 'test-abc123@example.test' }]);
  });

  it('until there is an admin, only the first admin may ask for a link; none at all without ADMIN_EMAIL', async () => {
    const db = await createTestDb();
    expect(await mayUseSignInLink(companyServer(), db, 'ANNA@acme.example')).toBe(true);
    expect(await mayUseSignInLink(companyServer(), db, 'ben@acme.example')).toBe(false);
    expect(await mayUseSignInLink(companyServer({ ADMIN_EMAIL: '', PD_TEST_AUTH: '1', APP_URL: 'http://localhost:3000' }), db, 'anna@acme.example')).toBe(false);
  });
});

describe('who may sign in once there is a team (plan 15)', () => {
  async function team() {
    const s = await setup();
    await s.db.insert(user).values([
      { id: 'u_anna', name: 'Anna Keller', email: 'anna@acme.example' }, { id: 'u_ben', name: 'Ben', email: 'ben@acme.example' },
      { id: 'u_gone', name: 'Gone', email: 'gone@acme.example' },
    ]);
    const ws = new TursoWorkspace(s.db);
    await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
    await ws.addMember({ personId: 'u_ben', role: 'viewer', addedBy: 'u_anna' });
    return { ...s, ws };
  }

  it('a member and an invited address get a link; a former member, a stranger and ADMIN_EMAIL’s new account do not', async () => {
    const { db, env, ws } = await team();
    await ws.invite({ email: 'cleo@acme.example', role: 'partnerManager', invitedBy: 'u_anna' });
    expect(await mayUseSignInLink(env, db, 'Ben@Acme.example')).toBe(true);
    expect(await mayUseSignInLink(env, db, 'cleo@acme.example')).toBe(true);
    expect(await mayUseSignInLink(env, db, 'gone@acme.example')).toBe(false);
    expect(await mayUseSignInLink(env, db, 'mallory@elsewhere.example')).toBe(false);
    // ADMIN_EMAIL is Anna's here, a member: she signs in as any member does. Once removed, the setting brings no one back.
    expect(await mayUseSignInLink(env, db, 'anna@acme.example')).toBe(true);
    await ws.setRole('u_ben', 'admin');
    await ws.removeMember('u_anna');
    expect(await mayUseSignInLink(env, db, 'anna@acme.example')).toBe(false);
  });

  it('an invited address with no account gets the invite: the link names who invited it; a member’s link doesn’t', async () => {
    const { auth, ws, sent } = await team();
    await ws.invite({ email: 'cleo@acme.example', role: 'partnerManager', invitedBy: 'u_anna' });
    await requestSignInLink(auth, 'cleo@acme.example', headers());
    await requestSignInLink(auth, 'ben@acme.example', headers());
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.find((l) => l.email === 'cleo@acme.example')).toMatchObject({ invitedBy: 'Anna Keller' });
    expect(sent.find((l) => l.email === 'ben@acme.example')).not.toHaveProperty('invitedBy');
  });

  it('an invited address becomes a user', async () => {
    const { db, auth, ws, sent } = await team();
    await ws.invite({ email: 'cleo@acme.example', role: 'partnerManager', invitedBy: 'u_anna' });
    await requestSignInLink(auth, 'cleo@acme.example', headers());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(await redeemSignInLink(auth, sent[0]!.token, headers())).not.toBeNull();
    expect((await db.all<{ email: string }>(sql`select email from user`)).map((r) => r.email)).toContain('cleo@acme.example');
  });

  it('a link sent before the invite was cancelled no longer makes a user, nor one sent before it ran out', async () => {
    const { db, auth, ws, sent } = await team();
    const cleo = await ws.invite({ email: 'cleo@acme.example', role: 'partnerManager', invitedBy: 'u_anna' });
    await requestSignInLink(auth, 'cleo@acme.example', headers());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await ws.cancelInvite(cleo.id);
    expect(await redeemSignInLink(auth, sent[0]!.token, headers())).toBeNull();
    // Dora's invite ran out: ten days ago, for 7 days.
    await ws.invite({ email: 'dora@acme.example', role: 'viewer', invitedBy: 'u_anna' });
    await requestSignInLink(auth, 'dora@acme.example', headers());
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    await db.run(sql`update workspace_invites set expires_at = '2020-01-01T00:00:00.000Z' where email = 'dora@acme.example'`);
    expect(await redeemSignInLink(auth, sent[1]!.token, headers())).toBeNull();
    expect((await db.all<{ email: string }>(sql`select email from user`)).map((r) => r.email).sort())
      .toEqual(['anna@acme.example', 'ben@acme.example', 'gone@acme.example']);
  });

  it('a former member invited again gets the invite email', async () => {
    const { auth, ws, sent } = await team();
    await ws.removeMember('u_ben');
    await ws.invite({ email: 'ben@acme.example', role: 'viewer', invitedBy: 'u_anna' });
    await requestSignInLink(auth, 'ben@acme.example', headers());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ invitedBy: 'Anna Keller' });
  });
});

describe('hosted keeps its sign-in (plan 14, task 2)', () => {
  it('has Google and no email link', async () => {
    const env = parseEnv({ DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' });
    const auth = buildAuth({ db: await createTestDb(), env });
    expect(auth.options.socialProviders?.google).toBeDefined();
    expect((auth.options.plugins ?? []).map((p) => p.id)).not.toContain('magic-link');
    expect(auth.options.databaseHooks).toBeUndefined();
  });
});
