import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  env: { CRON_SECRET: 'cron-secret-0123456789' as string | undefined, PD_TEST_AUTH: false }, // gitleaks:allow (a made-up test value)
  tick: vi.fn(async () => ({
    skipped: null, maps: 1, read: 1, refreshed: 0, sent: 2, failed: 0, paused: 0, cutShort: false, webhooksSent: 3, webhooksFailed: 1, webhooksTurnedOff: 0,
  })),
  cleanup: vi.fn(async () => ({ sessions: 0, rateLimits: 0, notifications: 1, mapEvents: 0, webhookDeliveries: 4, webhookMarks: 2 })),
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('@partner-desk/platform', () => ({ serverEnv: () => state.env }));
vi.mock('@/server/runtime', () => ({ notifyDeps: () => ({ deps: 'notify' }), cleanupDeps: () => ({ deps: 'cleanup' }), getDb: () => null }));
vi.mock('@/server/map-notifications', () => ({ runTick: state.tick, runCleanup: state.cleanup, shouldClean: () => true }));

const { GET, maxDuration } = await import('./route');
const call = (headers: Record<string, string> = {}) => GET(new Request('https://desk.test/api/cron/tick', { headers }));
const BEARER = { authorization: 'Bearer cron-secret-0123456789' };

beforeEach(() => {
  state.env = { CRON_SECRET: 'cron-secret-0123456789', PD_TEST_AUTH: false }; // gitleaks:allow (a made-up test value)
  state.tick.mockClear();
});

describe('GET /api/cron/tick (Vercel Cron)', () => {
  it('answers 401 without the secret, with a wrong one, and when no secret is set', async () => {
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: 'Bearer wrong-secret-0123456789' })).status).toBe(401);
    expect((await call({ authorization: 'cron-secret-0123456789' })).status).toBe(401);
    state.env.CRON_SECRET = undefined;
    expect((await call({ authorization: 'Bearer ' })).status).toBe(401);
    expect(state.tick).not.toHaveBeenCalled();
  });

  it('runs the job with the secret and answers counts only, never stored', async () => {
    const res = await call(BEARER);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      skipped: null, maps: 1, read: 1, refreshed: 0, sent: 2, failed: 0, paused: 0, cutShort: false, webhooksSent: 3, webhooksFailed: 1, webhooksTurnedOff: 0,
      cleanup: { sessions: 0, rateLimits: 0, notifications: 1, mapEvents: 0, webhookDeliveries: 4, webhookMarks: 2 },
    });
    expect(maxDuration).toBe(60);
  });

  it('takes the test clock only with test sign-in', async () => {
    const now = { ...BEARER, 'x-pd-test-now': '2026-11-03T07:30:00.000Z' };
    await call(now);
    expect((state.tick.mock.calls[0] as unknown[])[1]).not.toEqual(new Date('2026-11-03T07:30:00.000Z'));
    state.env.PD_TEST_AUTH = true;
    await call(now);
    expect((state.tick.mock.calls[1] as unknown[])[1]).toEqual(new Date('2026-11-03T07:30:00.000Z'));
  });
});

describe('vercel.json', () => {
  it('runs the job every 15 minutes', () => {
    const config = JSON.parse(readFileSync(join(__dirname, '../../../../../vercel.json'), 'utf8')) as { crons: unknown };
    expect(config.crons).toEqual([{ path: '/api/cron/tick', schedule: '*/15 * * * *' }]);
  });
});
