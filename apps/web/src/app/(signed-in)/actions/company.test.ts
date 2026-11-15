import type { Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const state = vi.hoisted(() => ({ session: null as OwnerSession | null, deps: null as unknown as ReturnType<typeof makeTestDeps> }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  companyFor: async () => ({ companyId: 'co_aaaaaaaaaa', name: '' }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { companyRename } = await import('./company');

const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };

beforeEach(() => {
  state.session = session;
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa', u_ben: 'co_bbbbbbbbbb' } });
});

describe('companyRename', () => {
  it('renames the person’s own company and answers with the cleaned name', async () => {
    expect(await companyRename({ name: '  Halden GmbH ' })).toEqual({ ok: true, name: 'Halden GmbH' });
    expect(state.deps.companies.names.get('u_anna')).toBe('Halden GmbH');
  });

  it('says why a name is refused, on the field', async () => {
    expect(await companyRename({ name: 'x'.repeat(81) })).toEqual({
      ok: false, error: 'invalid', message: COPY.COMPANY_NAME_TOO_LONG, fieldErrors: { name: COPY.COMPANY_NAME_TOO_LONG },
    });
  });

  it('never takes a user from the input', async () => {
    expect(await companyRename({ name: 'Halden', userId: 'u_ben' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(state.deps.companies.names.size).toBe(0);
  });

  it('answers a signed-out visitor with auth and renames nothing', async () => {
    state.session = null;
    expect(await companyRename({ name: 'Halden' })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
    expect(state.deps.companies.names.size).toBe(0);
  });
});
