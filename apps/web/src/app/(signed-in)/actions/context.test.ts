import { FORBIDDEN, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const state = vi.hoisted(() => ({ session: null as OwnerSession | null }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => makeTestDeps(),
  companyFor: async () => ({ companyId: 'co_aaaaaaaaaa', name: '' }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { asOwner } = await import('./context');

const member = (role: 'admin' | 'partnerManager' | 'viewer'): OwnerSession => ({
  owner: { userId: 'ws_aaaaaaaaaa', displayName: 'Vera' }, email: 'vera@halden.example', storage: 'database', personId: 'u_vera',
  member: { personId: 'u_vera', role },
});

beforeEach(() => { state.session = null; });

describe('asOwner (plan 15)', () => {
  it('tells a company server’s viewer why a change is refused', async () => {
    state.session = member('viewer');
    expect(await asOwner(async () => FORBIDDEN)).toEqual({ ...FORBIDDEN, message: COPY.VIEWER_READ_ONLY });
    // Only a refusal changes: an answer that went through is as it was.
    expect(await asOwner(async () => ({ ok: true as const, value: 1 }))).toEqual({ ok: true, value: 1 });
  });

  it('leaves everyone else’s refusal as it is, hosted too', async () => {
    state.session = member('partnerManager');
    expect(await asOwner(async () => FORBIDDEN)).toEqual(FORBIDDEN);
    state.session = { ...member('admin'), member: null, owner: { userId: 'u_anna', displayName: 'Anna' }, personId: 'u_anna' };
    expect(await asOwner(async () => FORBIDDEN)).toEqual(FORBIDDEN);
  });

  it('passes who sends an email to the work', async () => {
    state.session = member('partnerManager');
    expect(await asOwner(async ({ sender }) => sender)).toEqual({
      actor: { kind: 'owner', userId: 'ws_aaaaaaaaaa', displayName: 'Vera' }, name: 'Vera', email: 'vera@halden.example',
    });
  });
});
