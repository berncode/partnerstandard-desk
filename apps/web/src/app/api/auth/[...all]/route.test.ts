import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handler: (async () => new Response('ok')) as (request: Request) => Promise<Response>,
  log: [] as string[],
}));
vi.mock('@/server/runtime', () => ({ getAuth: () => ({ handler: (request: Request) => state.handler(request) }) }));
vi.mock('@/server/log', () => ({ log: (event: string, ids: Record<string, string>) => { state.log.push(`${event} ${JSON.stringify(ids)}`); } }));
vi.mock('next/navigation', () => ({
  unstable_rethrow: (error: unknown) => { if ((error as { digest?: unknown })?.digest === 'NEXT_TEST') throw error; },
}));

const { GET, POST } = await import('./route');

const token = 'Zk9f8e7d6c5b4a3210QwErTyUiOpAsDf'; // gitleaks:allow (a made-up test value)

function captureConsole(): () => string {
  const lines: string[] = [];
  const keep = (...args: unknown[]) => { lines.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 10 }))).join(' ')); };
  for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation(keep);
  return () => lines.join('\n');
}

beforeEach(() => {
  state.handler = async () => new Response('ok');
  state.log = [];
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the auth route', () => {
  it('passes Better Auth\'s answer on', async () => {
    const res = await GET(new Request('http://desk.test/api/auth/get-session'));
    expect(await res.text()).toBe('ok');
  });

  it.each([['GET', GET], ['POST', POST]] as const)('%s answers a thrown error with a bare 500 and logs no detail', async (_, method) => {
    state.handler = async () => {
      throw new Error(`Failed query: delete from "session" where "session"."token" = ?\nparams: ${token}`);
    };
    const logged = captureConsole();
    const res = await method(new Request('http://desk.test/api/auth/revoke-other-sessions', { method: 'POST' }));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('');
    expect(state.log).toEqual(['auth_request_failed {}']);
    expect(logged()).not.toContain(token);
  });

  it('lets Next.js own errors pass through', async () => {
    const own = Object.assign(new Error('next'), { digest: 'NEXT_TEST' });
    state.handler = async () => { throw own; };
    await expect(POST(new Request('http://desk.test/api/auth/sign-out', { method: 'POST' }))).rejects.toBe(own);
  });
});
