'use client';
// Where the person's work lives, for client screens (plan 13, task 12): set by each page's loader, which knows the
// session. Without a provider a screen gets Google's storage, so hosted screens are as before whatever is missed.
import { copyFor, type Copy } from '@partner-desk/copy';
import { Download, ExternalLink } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import type { StorageKind } from '@/storage-kind';

const StorageContext = createContext<StorageKind>('google');
/** A company server's viewer (plan 15): their pages are read only. Without a provider, nobody is. */
const ViewerContext = createContext(false);

export function StorageProvider({ storage, viewer = false, children }: { storage: StorageKind; viewer?: boolean; children: ReactNode }) {
  return (
    <StorageContext.Provider value={storage}>
      <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>
    </StorageContext.Provider>
  );
}

export const useStorageKind = (): StorageKind => useContext(StorageContext);

/** Whether the signed-in person is a company server's viewer, who reads and changes nothing (plan 15). */
export const useViewer = (): boolean => useContext(ViewerContext);

/** The texts for where the person's work lives: a company server's for the database, COPY everywhere else. */
export const useCopy = (): Copy => copyFor(useContext(StorageContext));

/**
 * A file link's attributes: a Drive link opens in a new tab; a database file is downloaded, so the page stays, and a
 * refused download (signed out, gone) never replaces the page with an empty one (task 12's review).
 */
export function useFileLinkProps(): { target?: '_blank'; rel?: 'noreferrer'; download?: '' } {
  return useContext(StorageContext) === 'database' ? { download: '' } : { target: '_blank', rel: 'noreferrer' };
}

/** A file link's icon: a new tab for a Drive file, a download for a database file. */
export function FileLinkIcon() {
  const Icon = useContext(StorageContext) === 'database' ? Download : ExternalLink;
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}

/** Downloads the file at `url` as a link with `download` would, from code (after a save the download must include). */
export function downloadFile(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}
