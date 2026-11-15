import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { createDatabasePartnerBookStore, exportWorkFile, MemoryWorkFiles } from '@partner-desk/storage';
import type { Actor } from './actor';
import { exportFile } from './files';
import { makeTestDeps } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const other: Actor = { kind: 'owner', userId: 'u2', displayName: 'Eva' };
const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId: 'c_1' } };

async function setup() {
  const files = new MemoryWorkFiles();
  const deps = { ...makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } }), fileExports: { export: (id: string) => exportWorkFile(files, id) } };
  const { fileId } = await createDatabasePartnerBookStore({ files, appBaseUrl: 'https://desk.test' }).create({ userId: 'u1', displayName: 'Ruth' }, 'co_aaaaaaaaaa');
  deps.events.events.length = 0;
  return { deps, files, fileId };
}

describe('exportFile', () => {
  it('gives the person their own company’s file, as tabs with a name, and records no event for the download, a read', async () => {
    const { deps, fileId } = await setup();
    const out = await exportFile(deps, owner, { fileId });
    expect(out).toMatchObject({ ok: true, value: { kind: 'partners', name: 'PartnerStandard Desk – Partners' } });
    expect(deps.events.events).toEqual([]);
  });

  it('answers not found for another company’s file, a file that is gone, and on hosted', async () => {
    const { deps, fileId } = await setup();
    expect(await exportFile(deps, other, { fileId })).toEqual({ ok: false, error: 'file_not_found', message: COPY.NOT_FOUND_FILE });
    expect(await exportFile(deps, owner, { fileId: 'wf_0123456789abcdef0123' })).toMatchObject({ ok: false, error: 'file_not_found' });
    const hosted = { ...deps, fileExports: undefined };
    expect(await exportFile(hosted, owner, { fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(deps.events.events).toEqual([]);
  });

  it('refuses an agent and an id that isn’t a database file id', async () => {
    const { deps, fileId } = await setup();
    expect(await exportFile(deps, agent, { fileId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await exportFile(deps, owner, { fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz' })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('says the database isn’t answering when it fails', async () => {
    const { deps, fileId } = await setup();
    const failing = { ...deps, fileExports: { export: async () => 'unavailable' as const } };
    expect(await exportFile(failing, owner, { fileId })).toEqual({ ok: false, error: 'unavailable', message: COPY.DB_UNAVAILABLE_MESSAGE });
  });
});
