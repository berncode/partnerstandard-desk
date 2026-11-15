// The rewrites go through the `refreshProgramOutputs` command, on the memory stores.
import { createProgram, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { StoreFailure } from '@partner-desk/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const state = vi.hoisted(() => ({
  session: null as OwnerSession | null,
  deps: null as unknown as ReturnType<typeof makeTestDeps>,
  log: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => ({ ...state.deps, log: state.log }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { POST, maxDuration } = await import('./route');

const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const COMPANY = 'co_aaaaaaaaaa';

/** As navigator.sendBeacon sends a string: text/plain, from the app's own origin. */
const beacon = (body: unknown, init: { origin?: string | null; type?: string } = {}) => {
  const headers = new Headers({ 'content-type': init.type ?? 'text/plain;charset=UTF-8' });
  if (init.origin !== null) headers.set('origin', init.origin ?? 'http://localhost:3800');
  return new Request('http://localhost:3800/api/programs/outputs', {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
};

async function program(): Promise<string> {
  const made = await createProgram(state.deps, anna, { companyId: COMPANY, partnerType: 'reseller', from: 'fresh' });
  if (!made.ok) throw new Error(made.error);
  return made.value.programId;
}

beforeEach(() => {
  state.session = session;
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa', u_bert: 'co_bbbbbbbbbb' } });
  state.log = vi.fn();
});

describe('POST /api/programs/outputs', () => {
  it('rewrites each program’s Program Sheet and Public page, and answers which failed and which were refused', async () => {
    const a = await program();
    const b = await program();
    const write = vi.spyOn(state.deps.programs, 'writeOutputs');
    const response = await POST(beacon({ programIds: [a, b] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ failed: [], refused: [] });
    expect(write).toHaveBeenCalledTimes(2);
    const [, sheet, publicText] = write.mock.calls[0]!;
    expect(sheet.eyebrow).toBe('Partner Program Sheet · internal');
    expect(publicText).toMatch(/^# /);
  });

  it('may run for a minute: 50 rewrites one after another take a while', () => {
    expect(maxDuration).toBe(60);
  });

  it('takes JSON whatever the content type says', async () => {
    const a = await program();
    expect((await POST(beacon({ programIds: [a] }, { type: 'application/json' }))).status).toBe(200);
    expect((await POST(beacon({ programIds: [a] }, { type: 'text/plain' }))).status).toBe(200);
  });

  it('needs the session cookie', async () => {
    const a = await program();
    state.session = null;
    const write = vi.spyOn(state.deps.programs, 'writeOutputs');
    expect((await POST(beacon({ programIds: [a] }))).status).toBe(401);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses another site', async () => {
    const a = await program();
    expect((await POST(beacon({ programIds: [a] }, { origin: 'https://evil.test' }))).status).toBe(403);
    // No Origin header (some clients leave it out on same-origin requests) is fine: the session cookie still decides.
    expect((await POST(beacon({ programIds: [a] }, { origin: null }))).status).toBe(200);
  });

  it.each([
    ['not JSON', 'programIds=pg_x'],
    ['no list', { programIds: 'pg_aaaaaaaaaa' }],
    ['an id that isn’t a program id', { programIds: ['co_aaaaaaaaaa'] }],
    ['an id that is too short', { programIds: ['pg_aaa'] }],
    ['more than 50', { programIds: Array.from({ length: 51 }, () => 'pg_aaaaaaaaaa') }],
    ['nothing', ''],
  ])('refuses %s with 400 and rewrites nothing', async (_name, body) => {
    const write = vi.spyOn(state.deps.programs, 'writeOutputs');
    expect((await POST(beacon(body))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('answers refused and failed ids, logs ids only, and goes on with the rest', async () => {
    const a = await program();
    const b = await program();
    const gone = 'pg_zzzzzzzzzz';
    vi.spyOn(state.deps.programs, 'writeOutputs')
      .mockRejectedValueOnce(new StoreFailure('unavailable', 'Google isn’t answering.'))
      .mockResolvedValueOnce(undefined);
    const response = await POST(beacon({ programIds: [a, gone, b] }));
    expect(await response.json()).toEqual({ failed: [a], refused: [gone] });
    expect(state.log).toHaveBeenCalledWith('program_outputs_failed', { programId: a, reason: 'unavailable' });
    expect(state.log).toHaveBeenCalledWith('program_outputs_failed', { programId: gone, reason: 'file_not_found' });
    expect(JSON.stringify(state.log.mock.calls)).not.toMatch(/answering|@/);
  });

  it('never rewrites another person’s program', async () => {
    const a = await program();
    state.session = { ...session, owner: { userId: 'u_bert', displayName: 'Bert' } };
    const write = vi.spyOn(state.deps.programs, 'writeOutputs');
    expect(await (await POST(beacon({ programIds: [a] }))).json()).toEqual({ failed: [], refused: [a] });
    expect(write).not.toHaveBeenCalled();
  });
});
