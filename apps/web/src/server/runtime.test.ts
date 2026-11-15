import { parseEnv, schema, type Db, type ServerEnv } from '@partner-desk/platform';
import { createTestDb } from '@partner-desk/platform/testing';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  env: null as unknown as ServerEnv,
  db: null as unknown as Db,
  headers: new Headers(),
  connection: Promise.resolve(),
  accountRow: null as null | (() => Promise<unknown>),
  log: [] as string[],
}));
vi.mock('next/headers', () => ({ headers: async () => state.headers, cookies: async () => ({ set: () => {}, get: () => undefined }) }));
vi.mock('next/server', () => ({ connection: () => state.connection }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  unstable_rethrow: (error: unknown) => { if ((error as { digest?: unknown })?.digest === 'NEXT_TEST') throw error; },
}));
vi.mock('./log', () => ({ log: (event: string, ids: Record<string, string>) => { state.log.push(`${event} ${JSON.stringify(ids)}`); } }));
vi.mock('@partner-desk/platform', async (orig) => {
  const real = await orig<typeof import('@partner-desk/platform')>();
  return {
    ...real, serverEnv: () => state.env, createDb: () => state.db,
    accountRow: (...args: Parameters<typeof real.accountRow>) => (state.accountRow ? state.accountRow() : real.accountRow(...args)),
  };
});

const { actorFor, authPlugins, companyFor, currentOwner, depsFor, getAuth, requireOwner } = await import('./runtime');

/** The parts of Better Auth's testUtils plugin these tests use. */
interface TestHelpers {
  createUser(input: { email: string; name: string }): unknown;
  saveUser(user: unknown): Promise<{ id: string }>;
  login(input: { userId: string }): Promise<{ headers: Headers; token: string }>;
}

const envOf = (overrides: Record<string, string> = {}) => parseEnv({
  DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), APP_URL: 'http://desk.test', PD_TEST_AUTH: '1', ...overrides,
});

let lastToken = '';

async function signIn(name: string, email: string): Promise<string> {
  const test = ((await getAuth().$context) as unknown as { test: TestHelpers }).test;
  const user = await test.saveUser(test.createUser({ email, name }));
  const login = await test.login({ userId: user.id });
  state.headers = login.headers;
  lastToken = login.token;
  return user.id;
}

beforeEach(async () => {
  (globalThis as { __partnerDeskShared?: unknown }).__partnerDeskShared = undefined;
  state.db = await createTestDb();
  state.env = envOf();
  state.headers = new Headers();
  state.connection = Promise.resolve();
  state.accountRow = null;
  state.log = [];
});

afterEach(() => { vi.restoreAllMocks(); });

describe('authPlugins', () => {
  it('adds testUtils first only in test sign-in mode, the agents’ sign-in on https or locally, and nextCookies always last', () => {
    expect(authPlugins(false, 'https://desk.test').map((plugin) => plugin.id)).toEqual(['jwt', 'oauth-provider', 'next-cookies']);
    expect(authPlugins(true, 'http://localhost:3000').map((plugin) => plugin.id)).toEqual(['test-utils', 'jwt', 'oauth-provider', 'next-cookies']);
    // A plain-http address elsewhere has no agent sign-in (the MCP address must be https).
    expect(authPlugins(true, 'http://desk.test').map((plugin) => plugin.id)).toEqual(['test-utils', 'next-cookies']);
  });

  it('gives the auth built outside test mode no test helpers', async () => {
    state.env = envOf({ PD_TEST_AUTH: '0', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
    expect(((await getAuth().$context) as unknown as { test?: unknown }).test).toBeUndefined();
  });
});

describe('currentOwner', () => {
  it('is null when signed out', async () => {
    expect(await currentOwner()).toBeNull();
  });

  it('gives a test user (no Google account) memory storage, and their name as the label', async () => {
    const id = await signIn('Anna', 'test-anna@example.test');
    const session = await currentOwner();
    expect(session).toEqual({ owner: { userId: id, displayName: 'Anna' }, email: 'test-anna@example.test', storage: 'memory', personId: id, member: null });
    expect(actorFor(session!)).toEqual({ kind: 'owner', userId: id, displayName: 'Anna' });
  });

  it('gives a person with a Google account Google storage', async () => {
    const id = await signIn('Ben', 'ben@example.com');
    await state.db.insert(schema.account).values({
      id: 'acc_1', accountId: 'google-ben', providerId: 'google', userId: id, createdAt: new Date(), updatedAt: new Date(),
    });
    expect((await currentOwner())?.storage).toBe('google');
  });
});

describe('currentOwner on a company server (plan 15)', () => {
  const companyServer = () => envOf({ EDITION: 'self-hosted', ADMIN_EMAIL: 'anna@halden.example', APP_URL: 'http://localhost:3000' });

  /** A person with an account but no invite: made straight in the database, as sign-in refuses to make them. */
  async function signInStranger(): Promise<void> {
    await state.db.insert(schema.user).values({ id: 'u_stranger', name: 'Sam', email: 'sam@halden.example' });
    const test = ((await getAuth().$context) as unknown as { test: TestHelpers }).test;
    state.headers = (await test.login({ userId: 'u_stranger' })).headers;
  }

  it('makes ADMIN_EMAIL the first admin, in the workspace: the work is the workspace’s, the person stays themselves', async () => {
    state.env = companyServer();
    const id = await signIn('Anna', 'anna@halden.example');
    const session = await currentOwner();
    const [ws] = await state.db.select().from(schema.workspace);
    expect(session).toEqual({
      owner: { userId: ws!.id, displayName: 'Anna' }, email: 'anna@halden.example', storage: 'database', personId: id,
      member: { personId: id, role: 'admin' },
    });
    expect(actorFor(session!)).toEqual({ kind: 'owner', userId: ws!.id, displayName: 'Anna', member: { personId: id, role: 'admin' } });
    // The company is the workspace's: none is made for the person.
    await companyFor(session!);
    expect((await state.db.select().from(schema.companies)).map((c) => c.ownerUserId)).toEqual([ws!.id]);
  });

  it('signs out a person who is no member: they reach nothing', async () => {
    state.env = companyServer();
    await signInStranger();
    expect(await currentOwner()).toBeNull();
    expect(await state.db.select().from(schema.workspaceMembers)).toEqual([]);
  });

  it('keeps a test user in a workspace of their own, so the e2e tests stay apart', async () => {
    state.env = companyServer();
    const id = await signIn('Tess', 'test-tess@example.test');
    expect(await currentOwner()).toMatchObject({ owner: { userId: id }, personId: id, member: null, storage: 'database' });
    expect(await state.db.select().from(schema.workspace)).toEqual([]);
  });
});

describe('currentOwner at request time', () => {
  it('reads nothing while there is no real request (a prerender or a prefetch)', async () => {
    await signIn('Anna', 'test-anna@example.test');
    const getSession = vi.spyOn(getAuth().api, 'getSession');
    let arrive!: () => void;
    state.connection = new Promise<void>((resolve) => { arrive = resolve; });
    const pending = currentOwner();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getSession).not.toHaveBeenCalled();
    arrive();
    expect((await pending)?.owner.displayName).toBe('Anna');
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  /** Everything written to the console, as text, with errors and their causes spelled out. */
  function captureConsole(): () => string {
    const lines: string[] = [];
    const keep = (...args: unknown[]) => { lines.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 10 }))).join(' ')); };
    for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation(keep);
    return () => lines.join('\n');
  }

  it('fails a broken session read with a plain error: no token, no query, in the error or the logs', async () => {
    await signIn('Anna', 'test-anna@example.test');
    await state.db.run('ALTER TABLE session RENAME TO session_gone');
    const logged = captureConsole();
    const error = await currentOwner().then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('session_read_failed');
    const all = `${inspect(error, { depth: 10 })}\n${logged()}\n${state.log.join('\n')}`;
    expect(all).not.toContain(lastToken);
    expect(all).not.toContain('select');
    expect(state.log).toEqual(['session_read_failed {}']);
  });

  it('fails a broken account read with a plain error: no query, no user id', async () => {
    const id = await signIn('Anna', 'test-anna@example.test');
    await state.db.run('ALTER TABLE account RENAME TO account_gone');
    const logged = captureConsole();
    const error = await currentOwner().then(() => null, (e: unknown) => e);
    expect((error as Error).message).toBe('google_account_read_failed');
    const all = `${inspect(error, { depth: 10 })}\n${logged()}`;
    expect(all).not.toContain('select');
    expect(all).not.toContain(id);
  });

  it('lets Next.js own errors from the account read pass through untouched', async () => {
    await signIn('Anna', 'test-anna@example.test');
    const own = Object.assign(new Error('next'), { digest: 'NEXT_TEST' });
    state.accountRow = async () => { throw own; };
    await expect(currentOwner()).rejects.toBe(own);
  });

  it('lets Next.js own errors pass through untouched', async () => {
    await signIn('Anna', 'test-anna@example.test');
    const own = Object.assign(new Error('next'), { digest: 'NEXT_TEST' });
    vi.spyOn(getAuth().api, 'getSession').mockRejectedValue(own);
    await expect(currentOwner()).rejects.toBe(own);
  });
});

describe('requireOwner', () => {
  it('sends a signed-out visitor to sign in, with the way back', async () => {
    await expect(requireOwner('/partners')).rejects.toThrow('redirect:/sign-in?next=%2Fpartners');
  });

  it('gives a signed-in person their dependencies', async () => {
    await signIn('Anna', 'test-anna@example.test');
    const { session, deps } = await requireOwner('/partners');
    expect(session.owner.displayName).toBe('Anna');
    expect(deps.partnerBooks).toBeDefined();
  });
});

describe('depsFor', () => {
  it('shares one set of memory stores between test users in one process', async () => {
    const session = { owner: { userId: 'u_a', displayName: 'A' }, email: 'a@example.test', storage: 'memory' as const, personId: 'u_a', member: null };
    const other = { owner: { userId: 'u_b', displayName: 'B' }, email: 'b@example.test', storage: 'memory' as const, personId: 'u_b', member: null };
    expect(depsFor(session).partnerBooks).toBe(depsFor(other).partnerBooks);
    expect(depsFor(session).markets).toBe(depsFor(other).markets);
  });
});

describe('companyFor', () => {
  it('gives each person their own company, the same one every time', async () => {
    const anna = { owner: { userId: 'u_a', displayName: 'A' }, email: 'a@example.test', storage: 'memory' as const, personId: 'u_a', member: null };
    const ben = { owner: { userId: 'u_b', displayName: 'B' }, email: 'b@example.test', storage: 'memory' as const, personId: 'u_b', member: null };
    const first = await companyFor(anna);
    expect(first.companyId).toMatch(/^co_[0-9a-z]{10}$/);
    expect(await companyFor(anna)).toEqual(first);
    expect((await companyFor(ben)).companyId).not.toBe(first.companyId);
  });
});
