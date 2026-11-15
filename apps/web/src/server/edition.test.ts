import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtStorage } from './edition';

describe('builtStorage (plan 13, task 13)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is Google’s in a Vercel build, which is always hosted, and unknown elsewhere until served', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(builtStorage()).toBe('google');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(builtStorage()).toBe('google');
    vi.stubEnv('VERCEL_ENV', '');
    expect(builtStorage()).toBeNull();
  });
});
