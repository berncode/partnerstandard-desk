import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabasePartnerBookStore, exportWorkFile, MemoryWorkFiles } from '@partner-desk/storage';
import { PARTNERS_LAYOUT } from '@partner-desk/storage/test-support';
import { makeTestDeps } from '@partner-desk/commands/testing';
import type { Actor, Deps } from '@partner-desk/commands';

type Session = { owner: { userId: string; displayName: string }; email: string; storage: 'google' | 'memory' | 'database' };
const state = vi.hoisted(() => ({ session: null as Session | null, deps: null as unknown as Deps }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  actorFor: (session: Session): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { GET } = await import('./route');
const get = (fileId: string) => GET(new Request(`https://desk.test/files/${fileId}/download`), { params: Promise.resolve({ fileId }) } as never);

let fileId: string;
beforeEach(async () => {
  const files = new MemoryWorkFiles();
  state.deps = { ...makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } }), fileExports: { export: (id: string) => exportWorkFile(files, id) } };
  fileId = (await createDatabasePartnerBookStore({ files, appBaseUrl: 'https://desk.test' }).create({ userId: 'u1', displayName: 'Anna' }, 'co_aaaaaaaaaa')).fileId;
  state.session = { owner: { userId: 'u1', displayName: 'Anna' }, email: 'anna@example.test', storage: 'database' };
});

describe('GET /files/[fileId]/download', () => {
  it('sends the person’s own file as an Excel file, named as its Drive file, never cached', async () => {
    const response = await get(fileId);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(response.headers.get('content-disposition')).toContain('filename="PartnerStandard Desk - Partners.xlsx"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const parts = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const sheets = [...strFromU8(parts['xl/workbook.xml']!).matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(sheets).toEqual(PARTNERS_LAYOUT.tabOrder);
    // The Accounts tab's header row, as the workbook holds it.
    expect(strFromU8(parts[`xl/worksheets/sheet${sheets.indexOf('Accounts') + 1}.xml`]!)).toContain('<t xml:space="preserve">Company</t>');
  });

  it('answers 503 when the database doesn’t answer', async () => {
    state.deps = { ...state.deps, fileExports: { export: async () => 'unavailable' as const } };
    expect((await get(fileId)).status).toBe(503);
  });

  it('answers 401 signed out, 404 on hosted, and 404 for another company’s file or a file that is gone', async () => {
    state.session = null;
    expect((await get(fileId)).status).toBe(401);
    state.session = { owner: { userId: 'u1', displayName: 'Anna' }, email: 'anna@example.test', storage: 'google' };
    expect((await get(fileId)).status).toBe(404);
    state.session = { owner: { userId: 'u2', displayName: 'Eva' }, email: 'eva@example.test', storage: 'database' };
    expect((await get(fileId)).status).toBe(404);
    state.session = { owner: { userId: 'u1', displayName: 'Anna' }, email: 'anna@example.test', storage: 'database' };
    expect((await get('wf_0123456789abcdef0123')).status).toBe(404);
  });
});
