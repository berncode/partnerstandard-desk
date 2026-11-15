'use client';

// New for PartnerStandard Desk (landing sample week): the app's own screens shown as a preview on a page that isn't
// them, such as the landing page's sample. Inside a preview the links are plain text, so nothing opens a signed-in page
// or prefetches one, and the sidebar marks the preview's page as the current one.
import Link from 'next/link';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';

const PreviewPathname = createContext<string | null>(null);

/** Inside it, the screens are a preview of the page at `pathname`. */
export function PreviewProvider({ pathname, children }: { pathname: string; children: ReactNode }) {
  return <PreviewPathname.Provider value={pathname}>{children}</PreviewPathname.Provider>;
}

/** The preview's page, or null outside a preview. */
export const usePreviewPathname = (): string | null => useContext(PreviewPathname);

/** A link's classes without its hover look: in a preview nothing lights up as if it could be clicked. */
const stillClasses = (className: string | undefined) => className?.split(/\s+/).filter((c) => !c.startsWith('hover:')).join(' ');

/**
 * `next/link` in the app; in a preview, its text in a span with the same look: no address, no focus, no click, no
 * hover. The span keeps the link's `title` and its `aria-current`, so a preview's current page still reads as current.
 */
export function AppLink({ href, className, title, children, ...rest }: ComponentProps<typeof Link>) {
  const preview = usePreviewPathname();
  if (preview === null) return <Link href={href} className={className} title={title} {...rest}>{children}</Link>;
  return <span className={stillClasses(className)} title={title} aria-current={rest['aria-current']}>{children}</span>;
}
