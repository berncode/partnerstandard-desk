import { agentContext } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAuth } from '@/server/agent-auth';

const state = vi.hoisted(() => ({
  resolve: null as unknown as (request: Request) => Promise<AgentAuth>,
  log: [] as Array<[string, Record<string, string>]>,
}));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/server/agent-auth', () => ({ resolveAgent: (request: Request) => state.resolve(request) }));
vi.mock('@/server/log', () => ({ log: (event: string, ids: Record<string, string>) => state.log.push([event, ids]) }));

const route = await import('./route');

const APP = 'http://localhost:3000';
const request = (path: string, method = 'GET', body?: unknown) => new Request(`${APP}/api/v1/${path}`, {
  method, headers: { authorization: 'Bearer pd_secret', 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const context = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });

async function signedIn(level: 'read' | 'change' = 'read'): Promise<AgentAuth> {
  const ctx = await agentContext(makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } }), { userId: 'u_anna', displayName: 'Anna', agentName: 'n8n', level, via: { kind: 'key', keyId: 'k_n8n' } });
  return { ok: true, ctx, grantKey: 'key:ak_1' };
}

beforeEach(() => {
  state.log = [];
});

describe('/api/v1/[...path]', () => {
  it('allows 60 seconds', () => {
    expect(route.maxDuration).toBe(60);
  });

  it('a refused credential is a 401 problem with resolveAgent’s header', async () => {
    const challenge = `Bearer resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`;
    state.resolve = async () => ({ ok: false, status: 401, headers: { 'WWW-Authenticate': challenge } });
    for (const method of ['GET', 'POST', 'PATCH'] as const) {
      const response = await route[method](request('partners', method), context('partners'));
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(challenge);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      expect(await response.json()).toEqual({
        type: 'https://desk.partnerstandard.com/problems/unauthorized', title: COPY.AGENT_UNAUTHORIZED, status: 401, code: 'unauthorized',
      });
    }
  });

  it('over the limit is a 429 problem with Retry-After', async () => {
    state.resolve = async () => ({ ok: false, status: 429, headers: { 'Retry-After': '12' } });
    const response = await route.GET(request('partners'), context('partners'));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(await response.json()).toMatchObject({ code: 'rate_limited', title: COPY.AGENT_RATE_LIMITED, status: 429 });
  });

  it('a database failure while checking the credential is a 503 problem; the log has the route only', async () => {
    state.resolve = async () => {
      throw new Error('api_keys_verify_failed: no such table api_keys (pd_secret)');
    };
    const response = await route.GET(request('partners'), context('partners'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'unavailable', title: COPY.AGENT_TRY_AGAIN, status: 503 });
    expect(state.log).toEqual([['agent_auth_failed', { route: 'api' }]]);
  });

  it('a checked agent is served', async () => {
    state.resolve = () => signedIn('read');
    const response = await route.POST(request('calc/recommend-4c', 'POST', { desk: { customerBase: 2, credibility: 0 } }), context('calc/recommend-4c'));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('recommendation');
  });

  it('an unknown route is a 404 problem once the agent is checked', async () => {
    state.resolve = () => signedIn('read');
    const response = await route.GET(request('nothing/here'), context('nothing/here'));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not_found_route' });
  });
});
