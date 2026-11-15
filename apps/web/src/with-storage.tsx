// Where the person's work lives, and whether they are a company server's viewer (plan 15), for the client screens of
// one page (plan 13, task 12). Put inside a page's Suspense,
// around its loader: the session is the request's cached one, so this adds no read, and the page's static shell stays.
import type { ReactNode } from 'react';
import { currentOwner } from '@/server/runtime';
import { StorageProvider } from '@/storage-context';

export async function WithStorage({ children }: { children: ReactNode }) {
  const session = await currentOwner();
  return <StorageProvider storage={session?.storage ?? 'google'} viewer={session?.member?.role === 'viewer'}>{children}</StorageProvider>;
}
