import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import type { Actor } from './actor';
import { renameCompany } from './companies';
import { makeTestDeps } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };

describe('renameCompany', () => {
  it('renames the actor’s own company, trimmed, and records an event without the name', async () => {
    const deps = makeTestDeps();
    expect(await renameCompany(deps, owner, { name: '  Halden GmbH ' })).toEqual({ ok: true, value: { name: 'Halden GmbH' } });
    expect(deps.companies.names.get('u1')).toBe('Halden GmbH');
    expect(deps.events.events).toEqual([expect.objectContaining({ command: 'company.rename', actorUserId: 'u1', entityIds: [] })]);
    expect(JSON.stringify(deps.events.events)).not.toContain('Halden');
  });

  it('clears the name with an empty one', async () => {
    const deps = makeTestDeps();
    await renameCompany(deps, owner, { name: 'Halden' });
    expect(await renameCompany(deps, owner, { name: '   ' })).toEqual({ ok: true, value: { name: '' } });
    expect(deps.companies.names.get('u1')).toBe('');
  });

  it('refuses a name that is too long or has special characters, with the reason on the field', async () => {
    const deps = makeTestDeps();
    expect(await renameCompany(deps, owner, { name: 'a'.repeat(81) })).toEqual({
      ok: false, error: 'invalid', message: COPY.COMPANY_NAME_TOO_LONG, fieldErrors: { name: COPY.COMPANY_NAME_TOO_LONG },
    });
    expect(await renameCompany(deps, owner, { name: 'Hal\nden' })).toEqual({
      ok: false, error: 'invalid', message: COPY.COMPANY_NAME_INVALID, fieldErrors: { name: COPY.COMPANY_NAME_INVALID },
    });
    expect(deps.companies.names.size).toBe(0);
    expect(deps.events.events).toEqual([]);
  });

  it('refuses input that is not just a name', async () => {
    const deps = makeTestDeps();
    expect(await renameCompany(deps, owner, { name: 'Halden', userId: 'u2' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await renameCompany(deps, owner, { name: 7 })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await renameCompany(deps, owner, null)).toMatchObject({ ok: false, error: 'invalid' });
    expect(deps.companies.names.size).toBe(0);
  });

  it('is for the person only, never an agent', async () => {
    const deps = makeTestDeps();
    expect(await renameCompany(deps, agent, { name: 'Halden' })).toEqual({ ok: false, error: 'forbidden', message: COPY.FORBIDDEN });
    expect(deps.companies.names.size).toBe(0);
    expect(deps.events.events).toEqual([]);
  });
});
