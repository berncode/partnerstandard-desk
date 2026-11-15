import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { CommunityEdition } from '@/landing/community-edition';
import { SampleWeekSection } from '@/sample/sample-week-section';
import { builtStorage } from '@/server/edition';
import { SiteFooter } from '@/ui/site-footer';
import { StaticHeader } from '@/ui/static-header';
import { AccountNotice, HeroActions, HostedOnly, StorageLine } from './landing-parts';
import { shownName } from '@/ui/brand';

/** Hosted's parts: in a Vercel build's static HTML (always hosted), elsewhere read when served (plan 14). */
const hosted = (node: React.ReactNode) => (builtStorage() ? node : <Suspense fallback={null}><HostedOnly>{node}</HostedOnly></Suspense>);

/**
 * The hero, the storage note, the account-deleted notice, the sample week, the Community Edition and the footer. A company
 * server shows only the name, the title and Sign in (owner, 2026-11-14). Signed in goes straight to /this-week.
 */
export default function Home(props: PageProps<'/'>) {
  return (
    <>
      <StaticHeader />
      <main className="flex flex-1 flex-col">
        <Suspense fallback={null}>
          <AccountNotice searchParams={props.searchParams} />
        </Suspense>
        <section className="mx-auto w-full max-w-6xl px-4 pt-14 pb-12 sm:pt-20">
          <p className="text-sm font-medium text-brand-strong">{shownName()}</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{COPY.LANDING_TITLE}</h1>
          {hosted(<p className="mt-5 max-w-2xl text-lg text-ink-2">{COPY.LANDING_TEXT}</p>)}
          <Suspense fallback={<div className="mt-8 h-11" />}>
            <HeroActions />
          </Suspense>
          {hosted(<StorageLine text={COPY.LANDING_STORAGE} />)}
        </section>
        {hosted(<><SampleWeekSection /><CommunityEdition /></>)}
      </main>
      <SiteFooter />
    </>
  );
}
