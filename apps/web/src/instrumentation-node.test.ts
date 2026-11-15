import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  env: { DATABASE_URL: 'file:/data/x.db', SCHEDULER: 'on', CRON_SECRET: 'from-settings-0000' } as Record<string, string | undefined>,
  ready: true, started: 0, stopped: 0, logged: [] as string[],
}));
// serverEnv() reads CRON_SECRET from the process when it is first called, as the real one does.
vi.mock('@partner-desk/platform/env', () => ({ serverEnv: () => ({ ...state.env, CRON_SECRET: state.env.CRON_SECRET ?? process.env.CRON_SECRET }) }));
vi.mock('@partner-desk/platform/startup', () => ({ prepareDatabase: vi.fn() }));
vi.mock('./server/company-start', () => ({ migrationsFolder: () => '/m', startCompanyServer: async () => state.ready }));
vi.mock('./server/log', () => ({ log: (event: string) => { state.logged.push(event); } }));
vi.mock('./server/scheduler', () => ({
  selfAddress: () => 'http://127.0.0.1:3000', callTick: vi.fn(),
  startScheduler: () => { state.started += 1; return { stop: async () => { state.stopped += 1; } }; },
}));

const memo = globalThis as unknown as { __partnerDeskScheduler?: unknown };
let savedSecret: string | undefined;
beforeEach(() => {
  delete memo.__partnerDeskScheduler;
  state.env = { DATABASE_URL: 'file:/data/x.db', SCHEDULER: 'on', CRON_SECRET: 'from-settings-0000' };
  state.ready = true;
  state.started = 0;
  state.stopped = 0;
  state.logged = [];
  savedSecret = process.env.CRON_SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedSecret;
  delete memo.__partnerDeskScheduler;
});

const { startNode: start } = await import('./instrumentation-node');
let shutdown: (() => void) | null = null;
const startNode = async () => {
  shutdown = null;
  await start((stop) => { shutdown = stop; });
};

describe('startNode', () => {
  it('starts the timer once the database is ready, and only once in a process; shutdown stops it', async () => {
    process.env.CRON_SECRET = 'from-settings-0000';
    await startNode();
    const stop = shutdown;
    await startNode();
    expect(state.started).toBe(1);
    expect(state.logged).toEqual(['scheduler_started']);
    stop!();
    await Promise.resolve();
    expect(state.stopped).toBe(1);
  });

  it('settings read with another secret than the process holds: no timer, and says so', async () => {
    process.env.CRON_SECRET = 'the-process-one-000';
    state.env.CRON_SECRET = 'an-earlier-read-000';
    await startNode();
    expect(state.started).toBe(0);
    expect(state.logged).toEqual(['scheduler_no_secret']);
  });

  it('next dev: no timer unless SCHEDULER is set', async () => {
    process.env.CRON_SECRET = 'from-settings-0000';
    const saved = { node: process.env.NODE_ENV, scheduler: process.env.SCHEDULER };
    try {
      (process.env as Record<string, string>).NODE_ENV = 'development';
      delete process.env.SCHEDULER;
      await startNode();
      expect(state.started).toBe(0);
      expect(state.logged).toEqual(['scheduler_off']);
      process.env.SCHEDULER = 'on';
      await startNode();
      expect(state.started).toBe(1);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = saved.node;
      if (saved.scheduler === undefined) delete process.env.SCHEDULER; else process.env.SCHEDULER = saved.scheduler;
    }
  });

  it('SCHEDULER=off: no timer', async () => {
    process.env.CRON_SECRET = 'from-settings-0000';
    state.env.SCHEDULER = 'off';
    await startNode();
    expect(state.started).toBe(0);
    expect(state.logged).toEqual(['scheduler_off']);
  });

  it('a failed start: no timer', async () => {
    state.ready = false;
    await startNode();
    expect(state.started).toBe(0);
  });

  it('without CRON_SECRET: a random one for this process, never empty, and the timer uses it', async () => {
    delete process.env.CRON_SECRET;
    state.env.CRON_SECRET = undefined;
    await startNode();
    expect(state.started).toBe(1);
    expect(process.env.CRON_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a CRON_SECRET that is set stays as it is', async () => {
    process.env.CRON_SECRET = 'mine-0000000000000';
    state.env.CRON_SECRET = 'mine-0000000000000';
    await startNode();
    expect(process.env.CRON_SECRET).toBe('mine-0000000000000');
  });
});
