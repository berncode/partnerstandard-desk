// The `/c/*` pages' frame, with PartnerStandard Desk's header and footer for pages outside the app frame.
import { ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/ui/site-footer';
import { StaticHeader } from '@/ui/static-header';

/**
 * The page around everything a MAP link shows (spec 4): no owner's session is read, so no account, no sidebar and no
 * owner's pages. The logo is not a link: nothing here leads into PartnerStandard Desk.
 */
export function LinkFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <>
      <StaticHeader home={false} />
      <main className={wide ? 'mx-auto w-full max-w-6xl flex-1 px-4 py-6 print:max-w-none print:p-0' : 'mx-auto w-full max-w-md flex-1 px-4 py-16'}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/** A link's dead end: why, and what to do. No owner's links, and never the owner's words about files. */
export function LinkNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="text-center">
      <ShieldOff className="mx-auto h-10 w-10 text-ink-3" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-ink-2">{children}</p>
    </div>
  );
}
