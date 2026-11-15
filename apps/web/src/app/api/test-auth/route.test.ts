import { buildAuth, parseEnv, type Auth } from '@partner-desk/platform';
import { createTestDb } from '@partner-desk/platform/testing';
import { testUtils } from 'better-auth/plugins';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => undefined }));
const state = vi.hoisted(() => ({ auth: null as unknown as Auth, testMode: true }));
vi.mock('@/server/runtime', () => ({ getAuth: () => state.auth }));
vi.mock('@partner-desk/platform', async (orig) => ({
  ...(await orig<typeof import('@partner-desk/platform')>()),
  testSignInEnabled: () => state.testMode,
  serverEnv: () => ({ APP_URL: 'http://127.0.0.1:3800' }),
}));

const { GET } = await import('./route');
// Next's server can hand the route another host than the one the browser used; the redirect follows APP_URL.
const req = (path: string) => new Request(`http://localhost:3800${path}`);

beforeEach(async () => {
  state.testMode = true;
  state.auth = buildAuth({
    db: await createTestDb(),
    env: parseEnv({ DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), PD_TEST_AUTH: '1' }),
    plugins: [testUtils()],
  });
});

describe('GET /api/test-auth', () => {
  it('is not there when test sign-in is off', async () => {
    state.testMode = false;
    const response = await GET(req('/api/test-auth'));
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('makes a throwaway user, signs them in and sends them on', async () => {
    const response = await GET(req('/api/test-auth?name=Anna&next=/partners'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3800/partners');
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('better-auth.session_token='))).toBe(true);
    const session = await state.auth.api.getSession({ headers: new Headers({ cookie: cookies.map((c) => c.split(';')[0]).join('; ') }) });
    expect(session?.user).toMatchObject({ name: 'Anna', email: expect.stringMatching(/^test-[0-9a-z]{10}@example\.test$/) });
  });

  it('never sends anyone off the site', async () => {
    const response = await GET(req('/api/test-auth?next=//evil.test/x'));
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3800/this-week');
  });

  it('lands on This week when no next is given', async () => {
    const response = await GET(req('/api/test-auth?name=Anna'));
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3800/this-week');
  });
});
