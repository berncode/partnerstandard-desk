// What the partner's page needs, without a session, in the place of the Business Case app's `shareDeps`.
import type { ShareDeps } from '@partner-desk/commands';
import {
  accountRow, ownerDisplayName, ownerExists, TursoCompanies, TursoDirectory, TursoReviewLinks, TursoShareLinks, type EditionFlags,
} from '@partner-desk/platform';
import type { CaseStore, MapStore, PartnerBookStore } from '@partner-desk/storage';
import { fileStoresFor, storageFor, type StorageKind, type Wiring } from './deps';

/** A share link: always on the app's own address (APP_URL), never on the host a request came in on. */
export function shareLinkUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/s/${token}`;
}

/** A review's summary link (reviews spec 5.6): on APP_URL too. */
export function summaryLinkUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/r/${token}`;
}

/**
 * The partner's page's dependencies (ruling R8). The owner's case store is built for the owner without a session, in
 * Google or in memory as `storageFor` decides for a signed-in person, and reads straight from the file: never through
 * the 60-second read cache, so the link never shows stale numbers. It only reads, so it has no file lock. An owner who
 * is gone (the account deleted) has no store. The owner's Partners store is built the same way, read only, for the
 * partner's name (owner, 2026-10-30). The company's name is only read: this page never makes a company. A review's
 * summary page (reviews spec 5.6) reads the owner's MAP the same way: straight from the file, read only, no lock.
 */
export function buildShareDeps(wiring: Wiring, { testMode, edition }: { testMode: boolean; edition: EditionFlags['edition'] }): ShareDeps {
  const { db } = wiring;
  const companies = new TursoCompanies(db);
  /** Where the owner's files live, as for a signed-in person; null when the owner is gone. */
  const storageOf = async (ownerUserId: string): Promise<StorageKind | null> => {
    if (!(await ownerExists(db, ownerUserId))) return null;
    return storageFor({ hasGoogleAccount: (await accountRow(db, ownerUserId)) !== null, testMode, edition });
  };
  /** The owner's stores as `fileStoresFor` chooses them for anyone: read straight from the file, no cache, no lock. */
  const storesOf = async (ownerUserId: string) => {
    const storage = await storageOf(ownerUserId);
    return storage === null ? null : fileStoresFor(wiring, ownerUserId, storage);
  };
  return {
    shareLinks: new TursoShareLinks(db),
    reviewLinks: new TursoReviewLinks(db),
    directory: new TursoDirectory(db),
    companies: { nameOf: (userId) => companies.nameOf(userId) },
    async casesFor(ownerUserId): Promise<CaseStore | null> {
      return (await storesOf(ownerUserId))?.cases ?? null;
    },
    async partnerBooksFor(ownerUserId): Promise<PartnerBookStore | null> {
      return (await storesOf(ownerUserId))?.partnerBooks ?? null;
    },
    async mapsFor(ownerUserId): Promise<MapStore | null> {
      return (await storesOf(ownerUserId))?.maps ?? null;
    },
    ownerName: (ownerUserId) => ownerDisplayName(db, ownerUserId),
    log: wiring.log,
  };
}
