// Plan 1's storage contract against fake Google, hand-edit cases included. Store-specific cases are in
// workbook-store.test.ts.
import { runCaseStoreContract } from '../case-store.contract';
import { runCompanyFactsStoreContract } from '../company-facts-store.contract';
import { runMapStoreContract } from '../map-store.contract';
import { runMarketStoreContract } from '../market-store.contract';
import { runProgramStoreContract } from '../program-store.contract';
import { runPartnerBookStoreContract } from '../partner-book-store.contract';
import { cacheReads, createReadCache } from '../read-cache';
import { MemoryFileLock, serializeApplies } from '../serialize';
import { MARKET_LAYOUT, PARTNERS_LAYOUT } from '../sheet-codec/layouts';
import { MAP_LAYOUT } from '../sheet-codec/map-layout';
import { MemoryWriteMarks } from '../write-marks';
import { FakeGoogle, fakeClient } from './fake-google';
import { MemoryFolderStore } from './folders';
import { createGoogleMapStore } from './map-store';
import { createGoogleMarketStore } from './market-store';
import { createSheetMetaCache } from './meta-cache';
import { createGoogleCaseStore } from './case-store';
import { createGooglePartnerBookStore } from './partner-book-store';
import { createGoogleCompanyFactsStore, createGoogleProgramStore } from './program-store';
import { googleRawAccess, googleSettingsRawAccess } from './raw-access';
import type { RawAccess, SettingsRawAccess } from '../types';

const owner = { userId: 'u_contract', displayName: 'Anna Keller' };

function plain() {
  const fake = new FakeGoogle();
  return { fake, options: { client: fakeClient(fake), folders: new MemoryFolderStore() } };
}

const READ_TTL = 60_000;
const HAND_EDITS = [
  'breakRow', 'removeTab', 'renameTab', 'breakField', 'typeCell', 'deleteRow', 'editSubField', 'addUserNotes', 'typeRowWithoutId', 'copyRow',
  'setSchemaVersion', 'addTab',
] as const;

/**
 * As the app wires it: a shared layout cache, applies one at a time per file, reads cached per owner. A hand edit
 * shows up in the app once the cached copy expires, so each one moves the clock past the read cache's 60 seconds.
 */
function wrapped() {
  const { fake, options } = plain();
  let now = 0;
  const clock = () => now;
  const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock });
  const cache = createReadCache({ ttlMs: READ_TTL, clock });
  const raw = (layout: Parameters<typeof googleRawAccess>[1]): RawAccess => {
    const inner = googleRawAccess(fake, layout);
    const out = { ...inner } as Record<string, unknown>;
    for (const name of HAND_EDITS) {
      out[name] = async (...args: unknown[]) => {
        const result = await (inner[name] as (...a: unknown[]) => Promise<unknown>)(...args);
        now += READ_TTL + 1;
        return result;
      };
    }
    return out as unknown as RawAccess;
  };
  return { options: { ...options, metaCache }, raw, wrap: { lock: new MemoryFileLock(), cache, marks: new MemoryWriteMarks() } };
}

runPartnerBookStoreContract('google (fake)', () => {
  const { fake, options } = plain();
  return { store: createGooglePartnerBookStore(options), owner, raw: googleRawAccess(fake, PARTNERS_LAYOUT) };
});

runPartnerBookStoreContract('google (fake), serialized and cached', () => {
  const { options, raw, wrap } = wrapped();
  const store = cacheReads(serializeApplies(createGooglePartnerBookStore(options), wrap.lock), wrap.cache, wrap.marks, { keyPrefix: owner.userId });
  return { store, owner, raw: raw(PARTNERS_LAYOUT) };
});

runMarketStoreContract('google (fake)', () => {
  const { fake, options } = plain();
  return { store: createGoogleMarketStore(options), owner, raw: googleRawAccess(fake, MARKET_LAYOUT) };
});

runMarketStoreContract('google (fake), serialized and cached', () => {
  const { options, raw, wrap } = wrapped();
  const store = cacheReads(serializeApplies(createGoogleMarketStore(options), wrap.lock), wrap.cache, wrap.marks, { keyPrefix: owner.userId });
  return { store, owner, raw: raw(MARKET_LAYOUT) };
});

runMapStoreContract('google (fake)', () => {
  const { fake, options } = plain();
  return { store: createGoogleMapStore(options), owner, raw: googleRawAccess(fake, MAP_LAYOUT) };
});

runMapStoreContract('google (fake), serialized and cached', () => {
  const { options, raw, wrap } = wrapped();
  const store = cacheReads(serializeApplies(createGoogleMapStore(options), wrap.lock), wrap.cache, wrap.marks, { keyPrefix: owner.userId });
  return { store, owner, raw: raw(MAP_LAYOUT) };
});

/** Hand edits on a Company facts or program file, each moving the clock past the read cache's 60 seconds. */
function settingsRaw(fake: FakeGoogle, tick: () => void): SettingsRawAccess {
  const inner = googleSettingsRawAccess(fake);
  const edits = ['typeRow', 'typeCell', 'typeSetting', 'renameTab'] as const;
  const out = { ...inner };
  for (const name of edits) {
    out[name] = (async (...args: unknown[]) => {
      await (inner[name] as (...a: unknown[]) => Promise<void>)(...args);
      tick();
    }) as never;
  }
  return out;
}

runProgramStoreContract('google (fake)', () => {
  const { fake, options } = plain();
  return { store: createGoogleProgramStore(options), owner, raw: googleSettingsRawAccess(fake) };
});

runProgramStoreContract('google (fake), serialized and cached', () => {
  const { fake, options, wrap, tick } = wrappedSettings();
  const store = cacheReads(serializeApplies(createGoogleProgramStore(options), wrap.lock), wrap.cache, wrap.marks, { keyPrefix: owner.userId });
  return { store, owner, raw: settingsRaw(fake, tick) };
});

runCompanyFactsStoreContract('google (fake)', () => {
  const { fake, options } = plain();
  return { store: createGoogleCompanyFactsStore(options), owner, raw: googleSettingsRawAccess(fake) };
});

runCompanyFactsStoreContract('google (fake), serialized and cached', () => {
  const { fake, options, wrap, tick } = wrappedSettings();
  const store = cacheReads(serializeApplies(createGoogleCompanyFactsStore(options), wrap.lock), wrap.cache, wrap.marks, { keyPrefix: owner.userId });
  return { store, owner, raw: settingsRaw(fake, tick) };
});

runCaseStoreContract('google (fake)', () => {
  const { fake, options } = plain();
  return { store: createGoogleCaseStore(options), owner, raw: googleSettingsRawAccess(fake) };
});

runCaseStoreContract('google (fake), serialized and cached', () => {
  const { fake, options, wrap, tick } = wrappedSettings();
  const store = cacheReads(serializeApplies(createGoogleCaseStore(options), wrap.lock), wrap.cache, wrap.marks, { keyPrefix: owner.userId });
  return { store, owner, raw: settingsRaw(fake, tick) };
});

/** As `wrapped`, for the settings files: the clock moves with each hand edit. */
function wrappedSettings() {
  const { fake, options } = plain();
  let now = 0;
  const clock = () => now;
  const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock });
  const cache = createReadCache({ ttlMs: READ_TTL, clock });
  return {
    fake, options: { ...options, metaCache }, tick: () => { now += READ_TTL + 1; },
    wrap: { lock: new MemoryFileLock(), cache, marks: new MemoryWriteMarks() },
  };
}
