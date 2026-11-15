import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const calls = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({
  session: null as OwnerSession | null, deleteResult: { ok: true } as { ok: boolean; message?: string },
  prefs: null as unknown as InstanceType<typeof import('@partner-desk/commands').MemoryEmailPrefs>,
  members: [] as Array<{ personId: string; role: string }>,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { calls.push(`redirect ${to}`); throw new Error('NEXT_REDIRECT'); },
}));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  getAuth: () => ({ api: { signOut: async () => { calls.push('signOut'); } } }),
  accountDeps: () => ({ marker: 'deps' }),
  emailPrefs: () => state.prefs,
  workspace: () => ({ members: async () => state.members }),
}));
vi.mock('@partner-desk/platform', () => ({
  deleteAccount: async (deps: unknown, userId: string, options?: { member?: boolean }) => {
    calls.push(`delete ${userId} ${JSON.stringify(deps)}${options?.member ? ' member' : ''}`);
    return state.deleteResult;
  },
}));

const { deleteMyAccount, setEmailType } = await import('./actions');
const { addressHash, MemoryEmailPrefs } = await import('@partner-desk/commands');
const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'google', personId: 'u_anna', member: null };

beforeEach(() => {
  calls.length = 0;
  state.session = session;
  state.deleteResult = { ok: true };
  state.prefs = new MemoryEmailPrefs();
  state.members = [];
});

describe('setEmailType', () => {
  it('turns one kind of email off and on for the signed-in person’s own address only', async () => {
    expect(await setEmailType('digest', false)).toEqual({ ok: true });
    expect(await state.prefs.isUnsubscribed(addressHash('anna@example.test'), 'digest')).toBe(true);
    expect(await setEmailType('digest', true)).toEqual({ ok: true });
    expect(await state.prefs.isUnsubscribed(addressHash('anna@example.test'), 'digest')).toBe(false);
  });

  it('refuses anything else, and a signed-out visitor', async () => {
    expect(await setEmailType('reconnect', false)).toMatchObject({ ok: false });
    expect(await setEmailType('digest', 'no')).toMatchObject({ ok: false });
    state.session = null;
    expect(await setEmailType('digest', false)).toMatchObject({ ok: false, message: COPY.SIGNED_OUT });
    expect(await state.prefs.listForHash(addressHash('anna@example.test'))).toEqual([]);
  });
});

describe('deleteMyAccount', () => {
  it('asks for DELETE and touches nothing otherwise', async () => {
    expect(await deleteMyAccount('delete')).toEqual({ ok: false, message: COPY.SETTINGS_DELETE_TYPE });
    expect(calls).toEqual([]);
  });

  it('answers a signed-out visitor with the signed-out message and deletes nothing', async () => {
    state.session = null;
    expect(await deleteMyAccount('DELETE')).toMatchObject({ ok: false, message: COPY.SIGNED_OUT });
    expect(calls).toEqual([]);
  });

  it('signs out first, deletes our records of that person only, then goes to the landing page notice', async () => {
    await expect(deleteMyAccount('DELETE')).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual(['signOut', 'delete u_anna {"marker":"deps"}', 'redirect /?account=deleted']);
  });

  it('on a company server, tells the last admin before signing out, and deletes nothing (plan 15)', async () => {
    state.session = { ...session, owner: { userId: 'ws_aaaaaaaaaa', displayName: 'Anna' }, member: { personId: 'u_anna', role: 'admin' } };
    state.members = [{ personId: 'u_anna', role: 'admin' }, { personId: 'u_ben', role: 'partnerManager' }];
    expect(await deleteMyAccount('DELETE')).toEqual({ ok: false, message: COPY.DELETE_ACCOUNT_LAST_ADMIN });
    expect(calls).toEqual([]);
  });

  it('on a company server, deletes the person’s own account as a member, never the workspace (plan 15)', async () => {
    state.session = { ...session, owner: { userId: 'ws_aaaaaaaaaa', displayName: 'Anna' }, member: { personId: 'u_anna', role: 'admin' } };
    state.members = [{ personId: 'u_anna', role: 'admin' }, { personId: 'u_ben', role: 'admin' }];
    await expect(deleteMyAccount('DELETE')).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual(['signOut', 'delete u_anna {"marker":"deps"} member', 'redirect /?account=deleted']);
  });

  it('says so when the records could not be deleted, and stays', async () => {
    state.deleteResult = { ok: false, message: COPY.DELETE_ACCOUNT_FAILED };
    expect(await deleteMyAccount('DELETE')).toEqual({ ok: false, message: COPY.DELETE_ACCOUNT_FAILED });
    expect(calls.some((c) => c.startsWith('redirect'))).toBe(false);
  });
});
