import { Suspense, type ReactNode } from 'react';
import { SiteFooter } from '@/ui/site-footer';
import { Sidebar } from './sidebar';

/**
 * The sidebar's place while it waits for the address: on a page with an id in its address (/partners/[accountId]) the
 * sidebar can only know the current link once the request comes, so the static shell holds this empty column.
 */
function SidebarPlaceholder() {
  return (
    <>
      <div aria-hidden className="sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-line bg-surface md:block print:hidden" />
      <div aria-hidden className="sticky top-0 z-30 h-14 border-b border-line bg-surface/85 md:hidden print:hidden" />
    </>
  );
}

/**
 * The frame of every signed-in screen: the sidebar, then the page. The company name, the account and the count of
 * waiting proposals come in as slots, so the layout can read the session inside Suspense and this shell stays static (cacheComponents).
 * The frame owns `<main>`: a page renders its content inside it.
 */
export function AppFrame({ company, user, proposalsWaiting, children }: {
  company: ReactNode; user: ReactNode; proposalsWaiting?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col md:flex-row">
      <Suspense fallback={<SidebarPlaceholder />}>
        <Sidebar company={company} account={user} proposalsWaiting={proposalsWaiting} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 print:max-w-none print:p-0">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
