import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ started: 0 }));
vi.mock('@partner-desk/platform/env', async (orig) => orig());
vi.mock('./instrumentation-node', () => ({ startNode: async () => { state.started += 1; } }));

const { register } = await import('./instrumentation');

const KEYS = ['NEXT_RUNTIME', 'NEXT_PHASE', 'EDITION', 'VERCEL_ENV'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  state.started = 0;
});
afterEach(() => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

describe('register', () => {
  it('a company server on Node: prepares the database', async () => {
    Object.assign(process.env, { NEXT_RUNTIME: 'nodejs', EDITION: 'self-hosted' });
    await register();
    expect(state.started).toBe(1);
  });

  it.each([
    ['hosted', { NEXT_RUNTIME: 'nodejs', EDITION: 'hosted' }],
    ['no edition set (hosted)', { NEXT_RUNTIME: 'nodejs' }],
    ['on Vercel', { NEXT_RUNTIME: 'nodejs', EDITION: 'self-hosted', VERCEL_ENV: 'preview' }],
    ['the edge runtime', { NEXT_RUNTIME: 'edge', EDITION: 'self-hosted' }],
    ['the build', { NEXT_RUNTIME: 'nodejs', EDITION: 'self-hosted', NEXT_PHASE: 'phase-production-build' }],
  ])('%s: does nothing', async (_name, env) => {
    Object.assign(process.env, env);
    await register();
    expect(state.started).toBe(0);
  });
});
