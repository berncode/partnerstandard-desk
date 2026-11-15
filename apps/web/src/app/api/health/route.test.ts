import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ vercel: false, storage: 'google' as 'google' | 'database', ping: vi.fn(async () => ({})), logged: [] as string[] }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => undefined }));
vi.mock('@/server/edition', () => ({
  builtStorage: () => (state.vercel ? 'google' : null),
  servedStorage: () => { if (state.vercel) throw new Error('settings read on Vercel'); return state.storage; },
}));
vi.mock('@/server/runtime', () => ({ getDb: () => ({ $client: { execute: state.ping } }) }));
vi.mock('@/server/log', () => ({ log: (event: string) => { state.logged.push(event); } }));

const { GET } = await import('./route');

beforeEach(() => {
  state.ping.mockReset();
  state.ping.mockResolvedValue({});
  state.logged = [];
  state.vercel = false;
});

describe('GET /api/health', () => {
  it('hosted: answers ok without asking the database, as before', async () => {
    state.storage = 'google';
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.ping).not.toHaveBeenCalled();
  });

  it('on Vercel: answers ok without reading the settings', async () => {
    state.vercel = true;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('a company server: ok once the database answers', async () => {
    state.storage = 'database';
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.ping).toHaveBeenCalledWith('SELECT count(*) FROM __drizzle_migrations');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a company server: 503 when the database does not answer, and a log line', async () => {
    state.storage = 'database';
    state.ping.mockRejectedValue(new Error('SQLITE_CANTOPEN'));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(state.logged).toEqual(['health_database_failed']);
  });
});
