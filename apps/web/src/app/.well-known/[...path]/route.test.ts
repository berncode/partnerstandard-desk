import { parseEnv, type Db, type ServerEnv } from '@partner-desk/platform';
import { createTestDb } from '@partner-desk/platform/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ env: null as unknown as ServerEnv, db: null as unknown as Db, log: [] as string[] }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ set: () => {}, get: () => undefined }) }));
vi.mock('next/server', () => ({ connection: async () => {}, after: () => {} }));
vi.mock('next/navigation', () => ({ redirect: () => {}, unstable_rethrow: () => {} }));
vi.mock('@/server/log', () => ({ log: (event: string) => { state.log.push(event); } }));
vi.mock('@partner-desk/platform', async (orig) => {
  const real = await orig<typeof import('@partner-desk/platform')>();
  return { ...real, serverEnv: () => state.env, createDb: () => state.db };
});

const { GET } = await import('./route');

const APP = 'http://localhost:3000';

beforeEach(async () => {
  (globalThis as { __partnerDeskShared?: unknown }).__partnerDeskShared = undefined;
  state.db = await createTestDb();
  state.env = parseEnv({ DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), APP_URL: APP, PD_TEST_AUTH: '1' });
  state.log = [];
});

describe('the discovery documents', () => {
  it('answers the protected resource metadata of the MCP address, with and without its path', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const res = await GET(new Request(`${APP}${path}`));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ resource: `${APP}/mcp`, authorization_servers: [`${APP}/api/auth`] });
    }
  });

  it('answers the authorization server metadata at the issuer’s path', async () => {
    const res = await GET(new Request(`${APP}/.well-known/oauth-authorization-server/api/auth`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      issuer: `${APP}/api/auth`, registration_endpoint: `${APP}/api/auth/oauth2/register`, code_challenge_methods_supported: ['S256'],
    });
  });

  it('answers anything else with 404', async () => {
    expect((await GET(new Request(`${APP}/.well-known/something-else`))).status).toBe(404);
  });
});
