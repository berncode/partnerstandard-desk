import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SiteFooter } from '@/ui/site-footer';
import { StaticHeader } from '@/ui/static-header';
import { Question } from './question';

// The address holds a signed request: never sent on as a referrer (next.config too), and kept out of search engines.
export const metadata: Metadata = { title: COPY.AGENT_ALLOW_PAGE_TITLE, referrer: 'no-referrer', robots: { index: false, follow: false } };

/**
 * Where the OAuth provider sends a person whose AI assistant (or another app) asks to use PartnerStandard Desk (agents spec
 * 4.3). A visit only shows the question; the grant happens on Allow (a POST).
 */
export default function AllowPage(props: PageProps<'/oauth/allow'>) {
  return (
    <>
      <StaticHeader />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
        <Suspense fallback={<div className="h-64" aria-busy="true" />}>
          <Question searchParams={props.searchParams} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
