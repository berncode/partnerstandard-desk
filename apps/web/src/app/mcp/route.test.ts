import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
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
const rpc = (body: unknown, method = 'POST') => new Request(`${APP}/mcp`, {
  method,
  headers: { authorization: 'Bearer pd_secret', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
};

/** A JSON-RPC answer, sent as JSON or as one server-sent event. */
async function answer(response: Response): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  const text = await response.text();
  const data = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data: '))!.slice('data: '.length);
  return JSON.parse(data) as { result?: Record<string, unknown> };
}

async function signedIn(level: 'read' | 'change' = 'read'): Promise<AgentAuth> {
  const ctx = await agentContext(makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } }), { userId: 'u_anna', displayName: 'Anna', agentName: 'n8n', level, via: { kind: 'key', keyId: 'k_n8n' } });
  return { ok: true, ctx, grantKey: 'key:ak_1' };
}

beforeEach(() => {
  state.log = [];
});

describe('/mcp', () => {
  it('allows 60 seconds', () => {
    expect(route.maxDuration).toBe(60);
  });

  it('answers a refused credential with resolveAgent’s 401 and its header, as is', async () => {
    const challenge = `Bearer resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`;
    state.resolve = async () => ({ ok: false, status: 401, headers: { 'WWW-Authenticate': challenge } });
    for (const method of ['POST', 'GET', 'DELETE'] as const) {
      const response = await route[method](rpc(initialize, method));
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(challenge);
    }
  });

  it('answers over the limit with 429 and Retry-After', async () => {
    state.resolve = async () => ({ ok: false, status: 429, headers: { 'Retry-After': '12' } });
    const response = await route.POST(rpc(initialize));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
  });

  it('a database failure while checking the credential answers 503 and logs no error text and no credential', async () => {
    state.resolve = async () => {
      throw new Error('api_keys_verify_failed: no such table api_keys (pd_secret)');
    };
    const response = await route.POST(rpc(initialize));
    expect(response.status).toBe(503);
    expect((await answer(response)).error).toMatchObject({ message: COPY.AGENT_TRY_AGAIN });
    expect(state.log).toEqual([['agent_auth_failed', { route: 'mcp' }]]);
  });

  it('a checked agent is served: initialize, then tools/list at its level', async () => {
    state.resolve = () => signedIn('read');
    const init = await route.POST(rpc(initialize));
    expect(init.status).toBe(200);
    expect((await answer(init)).result).toMatchObject({ serverInfo: { name: 'partner-desk' } });
    const list = await route.POST(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const tools = ((await answer(list)).result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(tools).toContain('get_partner');
    expect(tools).not.toContain('log_call');
  });

  it('a tool call is served on its own, with no session', async () => {
    state.resolve = () => signedIn('read');
    const call = await route.POST(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'recommend_4c', arguments: { desk: { customerBase: 2, credibility: 0 } } } }));
    expect(call.headers.get('mcp-session-id')).toBeNull();
    const { result } = await answer(call);
    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toHaveProperty('recommendation');
  });

  it('GET and DELETE answer 405 once the agent is checked: there are no sessions to stream or end', async () => {
    state.resolve = () => signedIn('read');
    expect((await route.GET(rpc(null, 'GET'))).status).toBe(405);
    expect((await route.DELETE(rpc(null, 'DELETE'))).status).toBe(405);
  });

  it.each([
    ['2025', ['2025-11-25', '2025-06-18']],
    ['2026-07-28', ['2026-07-28', '2025-11-25']],
  ])('an SDK client speaking the %s protocol gets the same answers, an unknown tool not_found included', async (era, versions) => {
    state.resolve = () => signedIn('read');
    const handle = (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const method = request.method as 'POST' | 'GET' | 'DELETE';
      return route[method](request);
    };
    const client = new Client({ name: 'test', version: '1.0.0' }, {
      supportedProtocolVersions: versions, versionNegotiation: { mode: era === '2025' ? 'legacy' : { pin: '2026-07-28' } },
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${APP}/mcp`), { fetch: handle }));
    try {
      expect(client.getServerVersion()?.name).toBe('partner-desk');
      expect(client.getNegotiatedProtocolVersion()).toBe(era === '2025' ? '2025-11-25' : '2026-07-28');
      expect((await client.listTools()).tools.map((t) => t.name)).not.toContain('log_call');
      const unknown = await client.callTool({ name: 'move_stage', arguments: {} });
      expect(unknown.isError).toBe(true);
      expect(JSON.stringify(unknown.content)).toContain(COPY.AGENT_NO_TOOL);
      const refused = await client.callTool({ name: 'log_call', arguments: {} });
      expect(JSON.stringify(refused.content)).toContain('code: forbidden');
    } finally {
      await client.close();
    }
  });
});
