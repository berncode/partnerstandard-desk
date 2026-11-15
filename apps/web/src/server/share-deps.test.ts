import { EXAMPLES } from '@partner-desk/core';
import { schema, SqliteWorkFiles, type Db } from '@partner-desk/platform';
import { createTestDb } from '@partner-desk/platform/testing';
import {
  createMemoryCaseStore, createMemoryCompanyFactsStore, createMemoryMapStore, createMemoryMarketStore, createMemoryPartnerBookStore, createMemoryProgramStore,
  createReadCache, MemoryFileLock,
} from '@partner-desk/storage';
import { createGoogleCaseStore, createSheetMetaCache } from '@partner-desk/storage/google';
import { FakeGoogle, fakeClient } from '@partner-desk/storage/google/fake';
import { TursoFolderStore } from '@partner-desk/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Wiring } from './deps';
import { buildShareDeps, shareLinkUrl } from './share-deps';
import { untouchableWorkFiles } from './wiring-test-helpers';

let db: Db;
let fake: FakeGoogle;
let wiring: Wiring;

/** Hosted never reaches the database edition's files (plan 13, task 10): checked after every test of this file. */
let hostedFiles: ReturnType<typeof untouchableWorkFiles>;
beforeEach(() => { hostedFiles = untouchableWorkFiles(); });
afterEach(() => { expect(hostedFiles.touched).toEqual([]); });

beforeEach(async () => {
  db = await createTestDb();
  fake = new FakeGoogle();
  wiring = {
    db,
    appUrl: 'https://desk.test',
    googleClient: () => fakeClient(fake),
    cache: createReadCache({ ttlMs: 60_000, clock: Date.now }),
    metaCache: createSheetMetaCache({ ttlMs: 600_000, clock: Date.now }),
    memory: {
      partnerBooks: createMemoryPartnerBookStore(), markets: createMemoryMarketStore(),
      programs: createMemoryProgramStore(), companyFacts: createMemoryCompanyFactsStore(), cases: createMemoryCaseStore(),
      maps: createMemoryMapStore(),
    },
    log: () => {},
    // Hosted: nothing may reach the database edition's files. Any call fails the test (plan 13, task 10).
    workFiles: hostedFiles,
    localLock: new MemoryFileLock(),
    webhooks: { key: 'test-secret-at-least-32-characters-long', allowPrivate: false },
  };
});

async function addUser(id: string, google: boolean) {
  await db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
  if (google) {
    await db.insert(schema.account).values({
      id: `acc_${id}`, accountId: `google-${id}`, providerId: 'google', userId: id, createdAt: new Date(), updatedAt: new Date(),
    });
  }
}

describe('shareLinkUrl', () => {
  it('puts the link on the app’s own address, never a request’s host', () => {
    expect(shareLinkUrl('https://desk.test', 'abc')).toBe('https://desk.test/s/abc');
    expect(shareLinkUrl('https://desk.test/', 'abc')).toBe('https://desk.test/s/abc');
  });
});

describe('buildShareDeps (the partner’s page, without a session)', () => {
  it('has no case store for an owner who is gone', async () => {
    const deps = buildShareDeps(wiring, { testMode: true, edition: 'hosted' });
    expect(await deps.casesFor('u_gone')).toBeNull();
  });

  it('gives a test user’s files in memory only in test mode', async () => {
    await addUser('u_test', false);
    expect(await buildShareDeps(wiring, { testMode: true, edition: 'hosted' }).casesFor('u_test')).toBe(wiring.memory.cases);
    // Outside test mode such a user still gets Google, as signed in (storageFor).
    expect(await buildShareDeps(wiring, { testMode: false, edition: 'hosted' }).casesFor('u_test')).not.toBe(wiring.memory.cases);
  });

  it('reads a Google owner’s case from Drive each time, never from the 60-second read cache (ruling R8)', async () => {
    await addUser('u_anna', true);
    const owner = { userId: 'u_anna', displayName: 'Anna' };
    const made = await createGoogleCaseStore({ client: fakeClient(fake), folders: new TursoFolderStore(db), appBaseUrl: wiring.appUrl })
      .create(owner, 'co_aaaaaaaaaa', structuredClone(EXAMPLES.saas.case));
    const store = await buildShareDeps(wiring, { testMode: false, edition: 'hosted' }).casesFor('u_anna');
    expect(store).not.toBeNull();
    expect((await store!.read({ fileId: made.fileId })).ok).toBe(true);
    const calls = fake.calls.length;
    expect((await store!.read({ fileId: made.fileId })).ok).toBe(true);
    expect(fake.calls.length).toBeGreaterThan(calls);
  });

  it('has the owner’s Partners store, as the case store: none for an owner who is gone, memory only in test mode', async () => {
    expect(await buildShareDeps(wiring, { testMode: true, edition: 'hosted' }).partnerBooksFor('u_gone')).toBeNull();
    await addUser('u_test', false);
    expect(await buildShareDeps(wiring, { testMode: true, edition: 'hosted' }).partnerBooksFor('u_test')).toBe(wiring.memory.partnerBooks);
    expect(await buildShareDeps(wiring, { testMode: false, edition: 'hosted' }).partnerBooksFor('u_test')).not.toBe(wiring.memory.partnerBooks);
    await addUser('u_anna', true);
    expect(await buildShareDeps(wiring, { testMode: false, edition: 'hosted' }).partnerBooksFor('u_anna')).not.toBeNull();
  });

  it('on the database edition, reads an owner’s files from this database, a test user’s too, and none for an owner who is gone', async () => {
    const self = { ...wiring, workFiles: new SqliteWorkFiles(db) };
    const deps = buildShareDeps(self, { testMode: true, edition: 'self-hosted' });
    expect(await deps.casesFor('u_gone')).toBeNull();
    await addUser('u_test', false);
    const owner = { userId: 'u_test', displayName: 'Test' };
    const store = (await deps.casesFor('u_test'))!;
    expect(store).not.toBe(wiring.memory.cases);
    const made = await store.create(owner, 'co_aaaaaaaaaa', structuredClone(EXAMPLES.saas.case));
    expect(made.fileUrl).toBe(`https://desk.test/files/${made.fileId}/download`);
    expect((await store.read({ fileId: made.fileId })).ok).toBe(true);
    expect(await deps.partnerBooksFor('u_test')).not.toBe(wiring.memory.partnerBooks);
    expect(await deps.mapsFor('u_test')).not.toBe(wiring.memory.maps);
    expect(fake.calls).toEqual([]);
  });

  it('reads the company’s name and never makes a company', async () => {
    const deps = buildShareDeps(wiring, { testMode: true, edition: 'hosted' });
    expect(await deps.companies.nameOf('u_anna')).toBeNull();
    expect(await db.select().from(schema.companies)).toEqual([]);
  });
});
